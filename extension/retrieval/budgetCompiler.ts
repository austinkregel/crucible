import * as vscode from 'vscode';
import type { RetrievedChunk } from './retriever';
import type { CollectedContext, ContextFile } from '../context/collector';
import type { RollingMemory } from '../cache/rollingMemory';
import type { ProjectGrounding } from '../context/projectGrounding';
import { composeSystemPrefix } from '../context/systemPrompt';
import { estimateTokens } from '../utils/tokens';

/** Priority tiers, lower number = higher priority */
export const enum Priority {
  P0_ALWAYS = 0,
  P1_HIGH = 1,
  P2_MEDIUM = 2,
  P3_LOW = 3,
  P4_EXPENDABLE = 4,
}

export interface ContextItem {
  priority: Priority;
  label: string;
  content: string;
  tokens: number;
  score?: number;
}

export interface BudgetResult {
  systemPrefix: string;
  userMessage: string;
  includedItems: ContextItem[];
  totalTokens: number;
  budgetUsed: number;
  budgetMax: number;
}

/**
 * Priority-based context budget compiler, inspired by Cursor's Priompt.
 *
 * Assigns each piece of context a priority tier. Fills the token budget
 * greedily from highest priority down. Within a tier, items are sorted
 * by relevance score and included until budget is exhausted.
 */
export class BudgetCompiler {
  private reserveForResponse: number;

  constructor(reserveForResponse = 4096) {
    this.reserveForResponse = reserveForResponse;
  }

  compile(opts: {
    userQuery: string;
    retrievedChunks?: RetrievedChunk[];
    collectedContext?: CollectedContext;
    rollingMemory?: RollingMemory;
    grounding?: ProjectGrounding;
    systemInstructions?: string;
    maxContextTokens?: number;
  }): BudgetResult {
    const maxTokens = opts.maxContextTokens ?? this.getModelBudget();
    const budget = maxTokens - this.reserveForResponse;

    const items: ContextItem[] = [];

    // --- P0: Always include ---

    const systemPrefix = composeSystemPrefix({
      roleInstructions: opts.systemInstructions,
    });

    const groundingSection = opts.grounding?.toPromptSection();
    if (groundingSection) {
      items.push({
        priority: Priority.P0_ALWAYS,
        label: 'Project Grounding',
        content: groundingSection,
        tokens: estimateTokens(groundingSection),
      });
    }

    if (opts.rollingMemory) {
      const section = opts.rollingMemory.toPromptSection();
      if (section) {
        items.push({
          priority: Priority.P0_ALWAYS,
          label: 'Project Knowledge',
          content: section,
          tokens: estimateTokens(section),
        });
      }
    }

    items.push({
      priority: Priority.P0_ALWAYS,
      label: 'User Query',
      content: `## User Request\n${opts.userQuery}`,
      tokens: estimateTokens(opts.userQuery),
    });

    // --- P1: High priority ---

    // Active editor file (current function/region)
    if (opts.collectedContext?.activeEditor) {
      const ae = opts.collectedContext.activeEditor;
      const text = ae.content || ae.summary || '';
      if (text) {
        items.push({
          priority: Priority.P1_HIGH,
          label: `Active File: ${ae.path}`,
          content: formatFile(ae),
          tokens: estimateTokens(text),
          score: 1.0,
        });
      }
    }

    // Explicitly @mentioned files
    if (opts.collectedContext?.files) {
      for (const file of opts.collectedContext.files) {
        const text = file.content || file.summary || '';
        if (text) {
          items.push({
            priority: Priority.P1_HIGH,
            label: `@mentioned: ${file.path}`,
            content: formatFile(file),
            tokens: estimateTokens(text),
            score: 0.9,
          });
        }
      }
    }

    // --- P2: Medium -- retrieved chunks from vector search ---

    if (opts.retrievedChunks) {
      for (const chunk of opts.retrievedChunks) {
        items.push({
          priority: Priority.P2_MEDIUM,
          label: `${chunk.relativePath}:${chunk.lineStart}-${chunk.lineEnd}`,
          content: formatChunk(chunk),
          tokens: estimateTokens(chunk.content),
          score: chunk.score,
        });
      }
    }

    // --- Fill budget ---

    const systemTokens = estimateTokens(systemPrefix);
    let remaining = budget - systemTokens;

    // Sort items: first by priority (ascending), then by score (descending)
    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    const included: ContextItem[] = [];
    const userParts: string[] = [];

    for (const item of items) {
      if (item.tokens <= remaining) {
        included.push(item);
        userParts.push(item.content);
        remaining -= item.tokens;
      } else if (item.priority <= Priority.P1_HIGH) {
        // For high-priority items that don't fit, try to truncate
        const truncated = truncateToFit(item.content, remaining);
        if (truncated) {
          const truncTokens = estimateTokens(truncated);
          included.push({ ...item, content: truncated, tokens: truncTokens });
          userParts.push(truncated);
          remaining -= truncTokens;
        }
      }
      // Lower priority items that don't fit are dropped
    }

    const userMessage = userParts.join('\n\n');

    return {
      systemPrefix,
      userMessage,
      includedItems: included,
      totalTokens: systemTokens + (budget - remaining),
      budgetUsed: budget - remaining,
      budgetMax: budget,
    };
  }

  private getModelBudget(): number {
    // Default context windows for common models
    const config = vscode.workspace.getConfiguration('crucible');
    const provider = config.get<string>('providers.ollama.model', 'qwen3:27b');

    // Conservative defaults -- real context windows are larger but we want
    // to leave room and avoid "lost in the middle" problems
    if (provider.includes('opus') || provider.includes('claude')) return 100_000;
    if (provider.includes('gpt-4o')) return 64_000;
    if (provider.includes('qwen')) return 32_000;
    return 16_000;
  }
}

function formatFile(file: ContextFile): string {
  const header = `### ${file.path}${file.language ? ` (${file.language})` : ''}`;
  if (file.summary) {
    return `${header}\n**Summary:** ${file.summary}`;
  }
  if (file.content) {
    return `${header}\n\`\`\`${file.language || ''}\n${file.content}\n\`\`\``;
  }
  return header;
}

function formatChunk(chunk: RetrievedChunk): string {
  const header = `### ${chunk.relativePath} (lines ${chunk.lineStart}-${chunk.lineEnd})`;
  const entities = chunk.entities ? `\n**Entities:** ${chunk.entities}` : '';
  return `${header}${entities}\n\`\`\`${chunk.language || ''}\n${chunk.content}\n\`\`\``;
}

function truncateToFit(content: string, maxTokens: number): string | null {
  if (maxTokens <= 50) return null;

  const lines = content.split('\n');
  let result = '';
  let tokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > maxTokens - 10) break;
    result += line + '\n';
    tokens += lineTokens;
  }

  if (result.length < 50) return null;
  return result + '\n... (truncated to fit context budget)';
}
