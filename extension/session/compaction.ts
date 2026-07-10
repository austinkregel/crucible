import type { ChatMessage, LLMProvider } from '../providers/types';
import { getModelLimits } from '../providers/types';
import { estimateTokens } from '../utils/tokens';
import type { StoredMessage, StoredTokenUsage } from './history';

const COMPACTION_BUFFER = 20_000;
const PRUNE_PROTECT_TOKENS = 40_000;
const PRUNE_MINIMUM_TOKENS = 20_000;
const TOOL_OUTPUT_MAX_CHARS = 2_000;
const DEFAULT_TAIL_TURNS = 2;
const MIN_PRESERVE_RECENT_TOKENS = 2_000;
const MAX_PRESERVE_RECENT_TOKENS = 8_000;

const COMPACTION_SYSTEM_PROMPT = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`;

const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`;

export function getUsableTokenBudget(model: string): number {
  const limits = getModelLimits(model);
  const maxOutput = limits.maxOutputTokens ?? Math.floor(limits.contextWindow * 0.25);
  const reserved = Math.min(COMPACTION_BUFFER, maxOutput);
  return Math.max(0, limits.contextWindow - maxOutput - reserved);
}

export function isOverflow(totalTokens: number, model: string): boolean {
  return totalTokens >= getUsableTokenBudget(model);
}

export function isOverflowFromUsage(tokens: StoredTokenUsage, model: string): boolean {
  const total = tokens.inputTokens + tokens.outputTokens
    + (tokens.reasoningTokens ?? 0)
    + (tokens.cachedTokens ?? 0);
  return isOverflow(total, model);
}

function preserveRecentBudget(model: string): number {
  const usable = getUsableTokenBudget(model);
  return Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable * 0.25)));
}

interface Turn {
  startIndex: number;
  endIndex: number;
}

function identifyTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      turns.push({ startIndex: i, endIndex: messages.length });
    }
  }
  for (let i = 0; i < turns.length - 1; i++) {
    turns[i].endIndex = turns[i + 1].startIndex;
  }
  return turns;
}

export function pruneToolOutputs(messages: ChatMessage[]): ChatMessage[] {
  const result = messages.map((m) => ({ ...m }));
  let protectedTokens = 0;
  let prunedTokens = 0;
  const toPrune: number[] = [];

  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (msg.role !== 'tool') continue;

    const estimate = estimateTokens(msg.content);
    protectedTokens += estimate;

    if (protectedTokens <= PRUNE_PROTECT_TOKENS) continue;

    prunedTokens += estimate;
    toPrune.push(i);
  }

  if (prunedTokens > PRUNE_MINIMUM_TOKENS) {
    for (const idx of toPrune) {
      const original = result[idx];
      const estimate = estimateTokens(original.content);
      result[idx] = {
        ...original,
        content: `[Tool output truncated - was ~${estimate} tokens. Tool: ${original.name ?? 'unknown'}]`,
      };
    }
  }

  return result;
}

function selectMessagesForCompaction(
  messages: ChatMessage[],
  model: string,
): { head: ChatMessage[]; tailStartIndex: number } {
  const budget = preserveRecentBudget(model);
  const turns = identifyTurns(messages);
  if (turns.length === 0) return { head: messages, tailStartIndex: messages.length };

  const limit = Math.min(DEFAULT_TAIL_TURNS, turns.length);
  const recentTurns = turns.slice(-limit);
  let total = 0;
  let keepFromIndex = messages.length;

  for (let i = recentTurns.length - 1; i >= 0; i--) {
    const turn = recentTurns[i];
    const slice = messages.slice(turn.startIndex, turn.endIndex);
    const size = estimateTokens(slice.map((m) => m.content).join('\n'));
    if (total + size <= budget) {
      total += size;
      keepFromIndex = turn.startIndex;
    } else {
      break;
    }
  }

  if (keepFromIndex === 0) return { head: messages, tailStartIndex: messages.length };
  return { head: messages.slice(0, keepFromIndex), tailStartIndex: keepFromIndex };
}

function buildCompactionPrompt(previousSummary?: string, extraContext?: string[]): string {
  const anchor = previousSummary
    ? [
        'Update the anchored summary below using the conversation history above.',
        'Preserve still-true details, remove stale details, and merge in the new facts.',
        '<previous-summary>',
        previousSummary,
        '</previous-summary>',
      ].join('\n')
    : 'Create a new anchored summary from the conversation history above.';
  const parts = [anchor, SUMMARY_TEMPLATE];
  if (extraContext?.length) parts.push(...extraContext);
  return parts.join('\n\n');
}

function truncateToolOutputsForSummary(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== 'tool') return m;
    if (m.content.length <= TOOL_OUTPUT_MAX_CHARS) return m;
    return {
      ...m,
      content: m.content.slice(0, TOOL_OUTPUT_MAX_CHARS) + '\n[... truncated for summary]',
    };
  });
}

export interface CompactionResult {
  summary: string;
  compactedMessages: ChatMessage[];
  tailMessages: ChatMessage[];
  tokensFreed: number;
}

export async function runCompaction(
  messages: ChatMessage[],
  model: string,
  provider: LLMProvider,
  previousSummary?: string,
): Promise<CompactionResult> {
  const { head, tailStartIndex } = selectMessagesForCompaction(messages, model);
  const tail = messages.slice(tailStartIndex);
  const headTokens = estimateTokens(head.map((m) => m.content).join('\n'));

  const truncatedHead = truncateToolOutputsForSummary(head);
  const compactionPrompt = buildCompactionPrompt(previousSummary);

  const compactionMessages: ChatMessage[] = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    ...truncatedHead,
    { role: 'user', content: compactionPrompt },
  ];

  let summary = '';
  for await (const token of provider.streamChat(compactionMessages, { model, temperature: 0.3 })) {
    summary += token;
  }

  summary = summary.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

  const compactedMessages: ChatMessage[] = [
    {
      role: 'system',
      content: `[Conversation summary - ${head.length} messages compacted]\n\n${summary}`,
    },
  ];

  const summaryTokens = estimateTokens(summary);
  const tokensFreed = Math.max(0, headTokens - summaryTokens);

  return { summary, compactedMessages, tailMessages: tail, tokensFreed };
}

export function rebuildMessagesAfterCompaction(result: CompactionResult): ChatMessage[] {
  return [...result.compactedMessages, ...result.tailMessages];
}

export function shouldAutoCompact(messages: ChatMessage[], model: string): boolean {
  const totalTokens = estimateTokens(messages.map((m) => m.content).join('\n'));
  return isOverflow(totalTokens, model);
}

export function storedMessagesToChat(stored: StoredMessage[]): ChatMessage[] {
  return stored
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool')
    .map((m) => {
      const msg: ChatMessage = {
        role: m.role as ChatMessage['role'],
        content: m.content,
      };
      if (m.role === 'tool' && m.toolName) msg.name = m.toolName;
      return msg;
    });
}
