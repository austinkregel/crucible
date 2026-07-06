export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  timeout?: number;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

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
