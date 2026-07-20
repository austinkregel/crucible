import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import * as cp from 'child_process';
import { TerminalTool } from '../terminal';
import { PermissionsManager } from '../../permissions';

describe('TerminalTool', () => {
  let tool: TerminalTool;
  let permissions: PermissionsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    permissions = new PermissionsManager();
    vi.spyOn(permissions, 'checkCommand').mockResolvedValue({ allowed: true });
    tool = new TerminalTool(permissions);
  });

  it('executes command and returns stdout on success', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: (...args: any[]) => void) =>
      cb(null, 'output', ''),
    );

    const result = await tool.execute({ command: 'ls' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('output');
  });

  it('returns error when command fails', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: (...args: any[]) => void) =>
      cb(new Error('fail'), '', 'error msg'),
    );

    const result = await tool.execute({ command: 'bad-cmd' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('error msg');
  });

  it('returns stderr appended to output when present', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: (...args: any[]) => void) =>
      cb(null, 'stdout', 'warn'),
    );

    const result = await tool.execute({ command: 'ls' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('stdout');
    expect(result.output).toContain('warn');
  });

  it('blocks command when permissions deny it', async () => {
    vi.spyOn(permissions, 'checkCommand').mockResolvedValue({
      allowed: false,
      reason: 'blocked',
    });

    const result = await tool.execute({ command: 'rm -rf /' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('uses workspace folder as cwd', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: (...args: any[]) => void) => {
      expect(opts.cwd).toBe('/test-workspace');
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'ls' });

    expect(cp.exec).toHaveBeenCalled();
  });

  it('uses relative cwd when provided', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: (...args: any[]) => void) => {
      expect(opts.cwd).toBe('/test-workspace/src');
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'ls', cwd: 'src' });

    expect(cp.exec).toHaveBeenCalled();
  });

  it('defaults to the configured command timeout and 8MB buffer', async () => {
    let seen: any;
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: (...args: any[]) => void) => {
      seen = opts;
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'npm test' });

    expect(seen.timeout).toBe(120_000);
    expect(seen.maxBuffer).toBe(8 * 1024 * 1024);
  });

  it('clamps an over-ceiling timeoutMs down to the ceiling', async () => {
    let seen: any;
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: (...args: any[]) => void) => {
      seen = opts;
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'npm test', timeoutMs: 5_000_000 });

    expect(seen.timeout).toBe(600_000);
  });

  it('honors a per-call timeoutMs within range', async () => {
    let seen: any;
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: (...args: any[]) => void) => {
      seen = opts;
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'npm test', timeoutMs: 45_000 });

    expect(seen.timeout).toBe(45_000);
  });

  it('reports a timeout error when the process is killed', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: (...args: any[]) => void) => {
      const err: any = new Error('killed');
      err.killed = true;
      err.signal = 'SIGTERM';
      cb(err, 'partial', '');
    });

    const result = await tool.execute({ command: 'sleep 999' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.output).toBe('partial');
  });

  it('truncates very long output keeping head and tail', async () => {
    const big = Array.from({ length: 1500 }, (_, i) => `line${i}`).join('\n');
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: (...args: any[]) => void) =>
      cb(null, big, ''),
    );

    const result = await tool.execute({ command: 'noisy' });

    expect(result.output).toContain('line0');
    expect(result.output).toContain('line1499');
    expect(result.output).toContain('500 lines omitted');
    // Head is lines 0-199, tail is lines 700-1499; line400 is in the dropped middle.
    expect(result.output).not.toContain('line400');
  });
});
