import type { ToolAccessPolicy } from '../tools/types';
import { loadAgentProfiles } from './profileLoader';

export type AgentMode = 'primary' | 'subagent';

export interface AgentProfile {
  name: string;
  description: string;
  mode: AgentMode;
  systemPrompt: string;
  allowedTools: string[];
  policy: ToolAccessPolicy;
  hidden?: boolean;
  temperature?: number;
  maxSteps?: number;
}

const EXPLORE_SYSTEM_PROMPT = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use search_code for searching file contents with regex
- Use read_file when you know the specific file path you need to read
- Use list_files for broad file pattern matching
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- Do not create any files or run commands that modify the user's system state

Complete the user's search request efficiently and report your findings clearly.`;

const COMPACTION_SYSTEM_PROMPT = `You are an anchored context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

Always follow the exact output structure requested by the user prompt. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing, compacting, or merging context. Respond in the same language as the conversation.`;

const BUILD_SYSTEM_PROMPT = `You are an AI coding assistant. You help users understand, modify, and improve their codebase.

You have access to tools for reading and writing files, searching code, listing directory contents, and running terminal commands. Use them as needed to accomplish the user's goals.

When making changes:
- Read the relevant files first to understand the context
- Make precise, targeted edits
- Explain what you changed and why`;

const GENERAL_SYSTEM_PROMPT = `You are a general-purpose agent for researching complex questions and executing multi-step tasks.

Your goal is to autonomously complete the task described in the prompt. Work through it step by step, using available tools as needed. Return a clear, concise summary of your findings or results.`;

const EXPLORE_POLICY: ToolAccessPolicy = {
  allowedTools: ['read_file', 'list_files', 'search_code'],
  terminalAllowed: false,
};

const COMPACTION_POLICY: ToolAccessPolicy = {
  allowedTools: [],
  terminalAllowed: false,
};

const GENERAL_POLICY: ToolAccessPolicy = {
  allowedTools: ['read_file', 'list_files', 'search_code', 'run_command'],
  terminalAllowed: true,
  requireApproval: { run_command: true },
};

function createBuildPolicy(workspaceRoot: string): ToolAccessPolicy {
  return {
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_files', 'search_code', 'run_command',
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

const BUILTIN_PROFILES: Record<string, Omit<AgentProfile, 'policy'> & { policy?: ToolAccessPolicy }> = {
  build: {
    name: 'build',
    description: 'The default agent. Executes tools based on configured permissions.',
    mode: 'primary',
    systemPrompt: BUILD_SYSTEM_PROMPT,
    allowedTools: ['read_file', 'write_file', 'edit_file', 'list_files', 'search_code', 'run_command'],
  },
  explore: {
    name: 'explore',
    description: 'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns, search code for keywords, or answer questions about the codebase. When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis.',
    mode: 'subagent',
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    allowedTools: ['read_file', 'list_files', 'search_code'],
    policy: EXPLORE_POLICY,
  },
  general: {
    name: 'general',
    description: 'General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.',
    mode: 'subagent',
    systemPrompt: GENERAL_SYSTEM_PROMPT,
    allowedTools: ['read_file', 'list_files', 'search_code', 'run_command'],
    policy: GENERAL_POLICY,
  },
  compaction: {
    name: 'compaction',
    description: 'Context compaction agent that summarizes conversation history.',
    mode: 'primary',
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    allowedTools: [],
    policy: COMPACTION_POLICY,
    hidden: true,
    temperature: 0.3,
  },
};

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();
  private workspaceRoot: string;

  constructor(workspaceRoot = '.') {
    this.workspaceRoot = workspaceRoot;

    for (const [key, profile] of Object.entries(BUILTIN_PROFILES)) {
      const policy = profile.policy ?? (key === 'build'
        ? createBuildPolicy(this.workspaceRoot)
        : EXPLORE_POLICY);
      this.profiles.set(key, { ...profile, policy });
    }
  }

  get(name: string): AgentProfile | undefined {
    return this.profiles.get(name);
  }

  list(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  listVisible(): AgentProfile[] {
    return this.list().filter((p) => !p.hidden);
  }

  listSubagents(): AgentProfile[] {
    return this.list().filter((p) => p.mode === 'subagent');
  }

  register(profile: AgentProfile): void {
    this.profiles.set(profile.name, profile);
  }

  /**
   * Load user-defined agent profiles from disk (.claude/agents, .crucible/agents)
   * and register them. File profiles override a built-in of the same name (with
   * a warning). Returns human-readable warnings for the caller to surface/log.
   */
  loadUserProfiles(): string[] {
    const { profiles, warnings } = loadAgentProfiles(this.workspaceRoot);
    for (const profile of profiles) {
      if (BUILTIN_PROFILES[profile.name]) {
        warnings.push(`Custom agent "${profile.name}" overrides the built-in agent of the same name.`);
      }
      this.register(profile);
    }
    return warnings;
  }

  getSubagentDescriptions(): string {
    return this.listSubagents()
      .map((p) => `"${p.name}": ${p.description}`)
      .join('\n');
  }
}
