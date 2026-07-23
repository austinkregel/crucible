import { describe, it, expect, vi } from 'vitest';
import { parseToolCalls, MAX_ARG_SIZE_BYTES } from '../toolCallParser';

describe('parseToolCalls', () => {
  it('extracts multiple tool calls from one response', () => {
    const response = `first
<tool_call>
{"name": "read_file", "arguments": {"path": "a.ts"}}
</tool_call>
<tool_call>
{"name": "read_file", "arguments": {"path": "b.ts"}}
</tool_call>`;
    const calls = parseToolCalls(response);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ name: 'read_file', arguments: { path: 'a.ts' } });
  });

  it('defaults missing arguments to {}', () => {
    const calls = parseToolCalls('<tool_call>{"name":"list_files"}</tool_call>');
    expect(calls[0]).toEqual({ name: 'list_files', arguments: {} });
  });

  it('rejects malformed JSON and logs via auditLogger', () => {
    const audit = { log: vi.fn() } as any;
    const calls = parseToolCalls('<tool_call>{not json}</tool_call>', undefined, audit);
    expect(calls).toHaveLength(0);
    expect(audit.log).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.stringContaining('Malformed') }));
  });

  it('rejects calls missing a name', () => {
    const calls = parseToolCalls('<tool_call>{"arguments":{}}</tool_call>');
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown tool names when a valid set is provided', () => {
    const audit = { log: vi.fn() } as any;
    const calls = parseToolCalls(
      '<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>',
      new Set(['read_file']),
      audit,
    );
    expect(calls).toHaveLength(0);
    expect(audit.log).toHaveBeenCalledWith('error', expect.objectContaining({ toolName: 'rm_rf' }));
  });

  it('rejects oversized payloads', () => {
    const big = 'x'.repeat(MAX_ARG_SIZE_BYTES + 1);
    const calls = parseToolCalls(`<tool_call>{"name":"read_file","arguments":{"path":"${big}"}}</tool_call>`);
    expect(calls).toHaveLength(0);
  });
});
