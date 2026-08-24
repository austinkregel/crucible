/**
 * Lanes #3 + #4 — the extension host <-> webview wire.
 *
 * This is the ONLY file the webview (src/) imports, and it MUST be imported type-only:
 *
 *     import type { ExtToWebview, WebviewToExt } from '@ext/contracts/protocol';
 *
 * A value import would pull Node-side code into the browser bundle. Everything here is types,
 * so `import type` erases cleanly at build time.
 *
 * Scope: this file freezes the NEW, agent-aware messages the concurrent feature needs. The
 * existing untyped messages (chat, planChat, agentChat, cancelRequest, ...) keep flowing as
 * they do today; migrating them into these unions is deliberately out of Phase 0 scope. #4
 * builds its UI against a fake emitter of `ExtToWebview`; #3 produces `agentQuestion` and
 * consumes `answerQuestion`.
 *
 * Depends on: ids, toolContext (AgentEvent), broker (AgentQuestion, AgentAnswer).
 */

import type { RunId, AgentId, QuestionId, AgentRef } from './ids';
import type { AgentEvent } from './toolContext';
import type { AgentQuestion, AgentAnswer } from './broker';

/** Re-export so the webview needs a single import for the whole wire. */
export type { AgentEvent } from './toolContext';
export type { AgentQuestion, AgentAnswer } from './broker';

/* ------------------------------------------------------------------ *
 * Extension host  ->  Webview
 * ------------------------------------------------------------------ */

/** An agent joined/changed/left the run tree. Drives the UI's per-agent lanes. */
export interface AgentTreeMsg {
  type: 'agentTree';
  runId: RunId;
  ref: AgentRef;
  state: 'queued' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';
}

/** An agent-scoped domain event (token/tool/notice/error), already attributed via `ref`. */
export interface AgentEventMsg {
  type: 'agentEvent';
  runId: RunId;
  event: AgentEvent;
}

/** A blocking question the user must answer to unblock the agent. Rendered attributed. */
export interface AgentQuestionMsg {
  type: 'agentQuestion';
  id: QuestionId;
  question: AgentQuestion; // carries `ref` for attribution
}

/** A question was resolved elsewhere (answered/cancelled/timed out) — dismiss its UI. */
export interface AgentQuestionResolvedMsg {
  type: 'agentQuestionResolved';
  id: QuestionId;
}

export type ExtToWebview =
  | AgentTreeMsg
  | AgentEventMsg
  | AgentQuestionMsg
  | AgentQuestionResolvedMsg;

/* ------------------------------------------------------------------ *
 * Webview  ->  Extension host
 * ------------------------------------------------------------------ */

/** The human's answer to one question. `id` correlates to AgentQuestionMsg. */
export interface AnswerQuestionMsg {
  type: 'answerQuestion';
  id: QuestionId;
  answer: AgentAnswer;
}

/** Cancel a single agent (from its lane's cancel button). */
export interface CancelAgentMsg {
  type: 'cancelAgent';
  agentId: AgentId;
}

/** Cancel a whole run (all its agents). */
export interface CancelRunMsg {
  type: 'cancelRun';
  runId: RunId;
}

export type WebviewToExt =
  | AnswerQuestionMsg
  | CancelAgentMsg
  | CancelRunMsg;
