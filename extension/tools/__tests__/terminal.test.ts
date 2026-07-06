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
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
      cb(null, 'output', ''),
    );

    const result = await tool.execute({ command: 'ls' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('output');
  });

  it('returns error when command fails', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
      cb(new Error('fail'), '', 'error msg'),
    );

    const result = await tool.execute({ command: 'bad-cmd' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('error msg');
  });

  it('returns stderr appended to output when present', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, _opts: any, cb: Function) =>
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
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: Function) => {
      expect(opts.cwd).toBe('/test-workspace');
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'ls' });

    expect(cp.exec).toHaveBeenCalled();
  });

  it('uses relative cwd when provided', async () => {
    (cp.exec as any).mockImplementation((_cmd: string, opts: any, cb: Function) => {
      expect(opts.cwd).toBe('/test-workspace/src');
      cb(null, 'ok', '');
    });

    await tool.execute({ command: 'ls', cwd: 'src' });

    expect(cp.exec).toHaveBeenCalled();
  });
});
