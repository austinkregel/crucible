import type { AuditLogger } from '../audit/logger';

/** 500KB limit per tool call's raw JSON payload. */
export const MAX_ARG_SIZE_BYTES = 512_000;

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * The single tool-call parser shared by the orchestrator executor loop and the
 * sub-agent loop. Extracts `<tool_call>{json}</tool_call>` blocks from a model
 * response, rejecting (with audit logging) oversized, malformed, nameless, or
 * unknown-tool calls rather than silently dropping them.
 *
 * Previously two divergent copies existed (executor vs sub-agent runner); the
 * runner's copy skipped all logging. This is the executor's stricter version,
 * now used by both call sites.
 */
export function parseToolCalls(
  response: string,
  validToolNames?: Set<string>,
  auditLogger?: AuditLogger,
): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const raw = match[1].trim();

    // Reject oversized payloads
    if (raw.length > MAX_ARG_SIZE_BYTES) {
      const msg = `Rejected tool call: payload exceeds ${MAX_ARG_SIZE_BYTES} bytes (got ${raw.length})`;
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, rawLength: raw.length });
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      const msg = `Malformed tool call JSON: ${err.message}`;
      console.warn(`[Crucible] ${msg}`, raw.slice(0, 200));
      auditLogger?.log('error', { message: msg, rawPreview: raw.slice(0, 500) });
      continue;
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      const msg = 'Tool call missing or invalid "name" field';
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, parsed });
      continue;
    }

    // Validate tool name against registered set
    if (validToolNames && !validToolNames.has(parsed.name)) {
      const msg = `Rejected unknown tool "${parsed.name}". Valid: ${[...validToolNames].join(', ')}`;
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, toolName: parsed.name });
      continue;
    }

    calls.push({
      name: parsed.name,
      arguments: parsed.arguments || {},
    });
  }

  return calls;
}
