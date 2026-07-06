import type { ToolAccessPolicy } from './types';

const READ_ONLY_TOOLS = ['read_file', 'list_files', 'search_code'];

export const ASK_POLICY: ToolAccessPolicy = {
  allowedTools: READ_ONLY_TOOLS,
  terminalAllowed: false,
};

export const PLAN_POLICY: ToolAccessPolicy = {
  allowedTools: READ_ONLY_TOOLS,
  terminalAllowed: false,
};

export function createAgentPolicy(workspaceRoot: string): ToolAccessPolicy {
  return {
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_files', 'search_code', 'run_command',
      'spawn_agent',
    ],
    fileWritePaths: [`${workspaceRoot}/**`],
    fileReadPaths: [`${workspaceRoot}/**`],
    terminalAllowed: true,
    requireApproval: {
      write_file: true,
      edit_file: true,
      run_command: false,
    },
  };
}

export function getPolicyForMode(
  mode: 'ask' | 'plan' | 'agent',
  workspaceRoot?: string,
): ToolAccessPolicy {
  switch (mode) {
    case 'ask':
      return ASK_POLICY;
    case 'plan':
      return PLAN_POLICY;
    case 'agent':
      return createAgentPolicy(workspaceRoot ?? '.');
  }
}
