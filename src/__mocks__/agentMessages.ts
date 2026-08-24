/**
 * Lane #4 mock seam — fabricates `ExtToWebview` sequences so the concurrent-agent UI (and its
 * tests) can run with NO backend. Nothing here imports Node code; it only builds wire objects.
 *
 * Used by:
 *   - tests, to drive the agents store / components with realistic messages.
 *   - dev, via `emitMockAgentRun(post)` to replay a scripted multi-agent run into the webview.
 */

import type {
  ExtToWebview,
  AgentTreeMsg,
  AgentEventMsg,
  AgentQuestionMsg,
  AgentQuestionResolvedMsg,
  AgentEvent,
  AgentQuestion,
} from '@ext/contracts/protocol';
import type { RunId, AgentId, QuestionId, AgentRef } from '@ext/contracts/ids';

// Branded-string casts — safe here because this file mints ids (the "mint site" in ids.ts terms).
export const runId = (s: string): RunId => s as unknown as RunId;
export const agentId = (s: string): AgentId => s as unknown as AgentId;
export const questionId = (s: string): QuestionId => s as unknown as QuestionId;

/** Plain (unbranded) inputs for building a ref — callers pass ordinary strings. */
export interface RefInput {
  runId: string;
  agentId: string;
  parentAgentId?: string;
  agentType?: string;
}

/** Build an AgentRef with sensible defaults, branding the ids at this mint site. */
export function makeRef(input: RefInput): AgentRef {
  return {
    runId: runId(input.runId),
    agentId: agentId(input.agentId),
    parentAgentId: input.parentAgentId ? agentId(input.parentAgentId) : undefined,
    agentType: input.agentType ?? 'general',
  };
}

export function treeMsg(ref: AgentRef, state: AgentTreeMsg['state']): AgentTreeMsg {
  return { type: 'agentTree', runId: ref.runId, ref, state };
}

export function eventMsg(ref: AgentRef, type: AgentEvent['type'], data: unknown): AgentEventMsg {
  return { type: 'agentEvent', runId: ref.runId, event: { ref, type, data } };
}

export function questionMsg(
  id: string,
  ref: AgentRef,
  question: Omit<AgentQuestion, 'ref'>,
): AgentQuestionMsg {
  return { type: 'agentQuestion', id: questionId(id), question: { ...question, ref } };
}

export function questionResolvedMsg(id: string): AgentQuestionResolvedMsg {
  return { type: 'agentQuestionResolved', id: questionId(id) };
}

/**
 * A scripted run: one root agent spawns two sub-agents that work concurrently; BOTH block on a
 * question at the same time (so the UI must surface two pending prompts attributed correctly).
 */
export function mockConcurrentRun(): ExtToWebview[] {
  const run = 'run-1';
  const root = makeRef({ runId: run, agentId: 'root', agentType: 'general' });
  const explore = makeRef({ runId: run, agentId: 'a-explore', parentAgentId: 'root', agentType: 'explore' });
  const edit = makeRef({ runId: run, agentId: 'a-edit', parentAgentId: 'root', agentType: 'edit' });

  return [
    treeMsg(root, 'running'),
    eventMsg(root, 'notice', { message: 'Spawning sub-agents to work in parallel.' }),

    treeMsg(explore, 'running'),
    treeMsg(edit, 'running'),

    // Interleaved activity — proves lanes stay independent.
    eventMsg(explore, 'toolCallStarted', { tool: 'search_code', args: { pattern: 'AuthService' } }),
    eventMsg(edit, 'streamToken', { token: 'Editing ' }),
    eventMsg(explore, 'toolCallCompleted', { tool: 'search_code', result: '3 matches in 2 files' }),
    eventMsg(edit, 'streamToken', { token: 'the login handler...' }),

    // Two agents block on the human simultaneously.
    treeMsg(explore, 'blocked'),
    questionMsg('q-explore', explore, {
      kind: 'choice',
      prompt: 'Which auth module should I focus on?',
      options: ['session.ts', 'oauth.ts', 'both'],
    }),
    treeMsg(edit, 'blocked'),
    questionMsg('q-edit', edit, {
      kind: 'approval',
      prompt: 'Overwrite src/login.ts with the refactored handler?',
      options: ['Allow', 'Deny'],
    }),
  ];
}

/** A single text question, for the simplest UI/test path. */
export function mockTextQuestion(): ExtToWebview[] {
  const ref = makeRef({ runId: 'run-2', agentId: 'a-1', agentType: 'general' });
  return [
    treeMsg(ref, 'running'),
    treeMsg(ref, 'blocked'),
    questionMsg('q-text', ref, {
      kind: 'text',
      prompt: 'What should the new environment variable be named?',
    }),
  ];
}

/**
 * Dev helper: replay a scripted sequence into a live webview by posting each message onto the
 * window (the same channel the extension host uses). Handy from a browser console during dev.
 */
export function emitMockAgentRun(
  messages: ExtToWebview[] = mockConcurrentRun(),
  post: (msg: ExtToWebview) => void = (msg) =>
    window.postMessage(msg as unknown as Record<string, unknown>, '*'),
  stepMs = 400,
): void {
  messages.forEach((msg, i) => setTimeout(() => post(msg), i * stepMs));
}
