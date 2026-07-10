import { describe, it, expect, afterEach } from 'vitest';
import { ASK_POLICY, PLAN_POLICY, createAgentPolicy, getPolicyForMode } from '../policies';
import { _configStore } from '../../__mocks__/vscode';

describe('ToolAccessPolicy definitions', () => {
  describe('ASK_POLICY', () => {
    it('only allows read-only tools', () => {
      expect(ASK_POLICY.allowedTools).toEqual(['read_file', 'list_files', 'search_code']);
    });

    it('does not allow terminal access', () => {
      expect(ASK_POLICY.terminalAllowed).toBe(false);
    });

    it('does not define write paths', () => {
      expect(ASK_POLICY.fileWritePaths).toBeUndefined();
    });
  });

  describe('PLAN_POLICY', () => {
    it('has the same read-only tools as Ask', () => {
      expect(PLAN_POLICY.allowedTools).toEqual(ASK_POLICY.allowedTools);
    });

    it('does not allow terminal access', () => {
      expect(PLAN_POLICY.terminalAllowed).toBe(false);
    });
  });

  describe('createAgentPolicy', () => {
    it('includes all tools', () => {
      const policy = createAgentPolicy('/workspace');
      expect(policy.allowedTools).toContain('read_file');
      expect(policy.allowedTools).toContain('write_file');
      expect(policy.allowedTools).toContain('edit_file');
      expect(policy.allowedTools).toContain('run_command');
      expect(policy.allowedTools).toContain('list_files');
      expect(policy.allowedTools).toContain('search_code');
    });

    it('allows terminal access', () => {
      const policy = createAgentPolicy('/workspace');
      expect(policy.terminalAllowed).toBe(true);
    });

    it('scopes file writes to workspace root', () => {
      const policy = createAgentPolicy('/my/project');
      expect(policy.fileWritePaths).toEqual(['/my/project/**']);
    });

    it('requires approval for terminal by default', () => {
      const policy = createAgentPolicy('/workspace');
      expect(policy.requireApproval?.run_command).toBe(true);
    });

    it('requires approval for file writes', () => {
      const policy = createAgentPolicy('/workspace');
      expect(policy.requireApproval?.write_file).toBe(true);
      expect(policy.requireApproval?.edit_file).toBe(true);
    });

    it('allows opting out of terminal approval explicitly', () => {
      const policy = createAgentPolicy('/workspace', false);
      expect(policy.requireApproval?.run_command).toBe(false);
    });
  });

  describe('getPolicyForMode', () => {
    afterEach(() => {
      _configStore['terminal.requireApproval'] = false;
    });

    // The `crucible.terminal.requireApproval` setting must actually reach the
    // policy the runner enforces; otherwise the setting is inert.
    it('agent mode honors terminal.requireApproval=true from config', () => {
      _configStore['terminal.requireApproval'] = true;
      const policy = getPolicyForMode('agent', '/ws');
      expect(policy.requireApproval?.run_command).toBe(true);
    });

    it('agent mode honors terminal.requireApproval=false from config', () => {
      _configStore['terminal.requireApproval'] = false;
      const policy = getPolicyForMode('agent', '/ws');
      expect(policy.requireApproval?.run_command).toBe(false);
    });

    it('returns ASK_POLICY for ask mode', () => {
      const policy = getPolicyForMode('ask');
      expect(policy).toBe(ASK_POLICY);
    });

    it('returns PLAN_POLICY for plan mode', () => {
      const policy = getPolicyForMode('plan');
      expect(policy).toBe(PLAN_POLICY);
    });

    it('returns agent policy for agent mode', () => {
      const policy = getPolicyForMode('agent', '/ws');
      expect(policy.allowedTools).toContain('write_file');
      expect(policy.terminalAllowed).toBe(true);
    });
  });
});
