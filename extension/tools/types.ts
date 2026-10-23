// The canonical, ctx-aware AgentTool lives with the Phase 0 contracts. Re-exported here so
// existing `import { AgentTool } from './types'` sites resolve to the new signature
// (execute(args, ctx)). See extension/contracts/toolContext.ts.
export type { AgentTool, ToolContext, AgentEvent } from '../contracts/toolContext';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolAccessPolicy {
  allowedTools: string[];
  fileWritePaths?: string[];
  fileReadPaths?: string[];
  terminalAllowed: boolean;
  terminalAllowList?: string[];
  terminalBlockList?: string[];
  requireApproval?: {
    [toolName: string]: boolean | undefined;
  };
}
