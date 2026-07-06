import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionsManager } from '../permissions';
import { _configStore, window } from '../__mocks__/vscode';

describe('PermissionsManager', () => {
  let manager: PermissionsManager;

  beforeEach(() => {
    manager = new PermissionsManager();
    _configStore['terminal.allowedCommands'] = ['npm', 'npx', 'git', 'ls', 'node'];
    _configStore['terminal.blockedCommands'] = ['rm -rf /', 'sudo'];
    _configStore['terminal.requireApproval'] = false;
    vi.clearAllMocks();
  });

  it('allows commands starting with allowed binaries', async () => {
    const result = await manager.checkCommand('npm install');
    expect(result.allowed).toBe(true);
  });

  it('blocks commands matching blocked patterns', async () => {
    const rmResult = await manager.checkCommand('rm -rf /');
    expect(rmResult.allowed).toBe(false);
    expect(rmResult.reason).toContain('blocked pattern');

    const sudoResult = await manager.checkCommand('sudo apt install');
    expect(sudoResult.allowed).toBe(false);
    expect(sudoResult.reason).toContain('blocked pattern');
  });

  it('blocks commands with binary not in allowlist', async () => {
    const result = await manager.checkCommand('curl http://evil.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in the allowed commands list');
  });

  describe('with requireApproval=true', () => {
    beforeEach(() => {
      _configStore['terminal.requireApproval'] = true;
    });

    it('allows when user chooses Allow', async () => {
      window.showWarningMessage.mockResolvedValueOnce('Allow');
      const result = await manager.checkCommand('npm test');
      expect(result.allowed).toBe(true);
    });

    it('blocks when user chooses Deny', async () => {
      window.showWarningMessage.mockResolvedValueOnce('Deny');
      const result = await manager.checkCommand('npm test');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('denied');
    });

    it('remembers approval with Allow & Remember', async () => {
      window.showWarningMessage.mockResolvedValueOnce('Allow & Remember');
      const first = await manager.checkCommand('npm test');
      expect(first.allowed).toBe(true);

      const second = await manager.checkCommand('npm test');
      expect(second.allowed).toBe(true);
      expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearSessionApprovals()', () => {
    it('clears remembered approvals', async () => {
      _configStore['terminal.requireApproval'] = true;
      window.showWarningMessage.mockResolvedValue('Allow & Remember');

      await manager.checkCommand('npm test');
      manager.clearSessionApprovals();

      window.showWarningMessage.mockResolvedValueOnce('Deny');
      const result = await manager.checkCommand('npm test');
      expect(result.allowed).toBe(false);
    });
  });
});
