import * as fs from 'fs';
import * as path from 'path';
import type { AgentProfile, AgentMode } from './registry';
import type { ToolAccessPolicy } from '../tools/types';
import { parseFrontmatter } from '../utils/frontmatter';

/**
 * Loads user-defined agent profiles from disk so the sub-agent system can be
 * extended without code changes -- mirroring the .claude/agents convention.
 *
 * Each file is Markdown with YAML-ish frontmatter:
 *
 *   ---
 *   name: reviewer
 *   description: Reviews a diff for bugs
 *   tools: read_file, search_code, list_files
 *   mode: subagent            # or "primary"; default subagent
 *   temperature: 0.2          # optional
 *   ---
 *   <the system prompt / instructions>
 *
 * The frontmatter drives allowedTools and a derived ToolAccessPolicy; the body
 * becomes the system prompt.
 */

/** Directories scanned, in order. Both conventions are supported. */
const AGENT_DIRS = ['.claude/agents', '.crucible/agents'];

/** Read-only default when a profile omits `tools`. */
const DEFAULT_TOOLS = ['read_file', 'list_files', 'search_code'];

export interface LoadedProfiles {
  profiles: AgentProfile[];
  warnings: string[];
}

export function loadAgentProfiles(workspaceRoot: string): LoadedProfiles {
  const profiles: AgentProfile[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const dir of AGENT_DIRS) {
    const abs = path.join(workspaceRoot, dir);
    let entries: string[];
    try {
      entries = fs.readdirSync(abs);
    } catch {
      continue; // directory absent -- fine
    }

    for (const file of entries) {
      if (!file.endsWith('.md')) continue;
      const rel = `${dir}/${file}`;
      let content: string;
      try {
        content = fs.readFileSync(path.join(abs, file), 'utf-8');
      } catch (err: any) {
        warnings.push(`Failed to read agent file ${rel}: ${err.message}`);
        continue;
      }

      const result = parseAgentProfile(content, file, workspaceRoot);
      if (!result.profile) {
        warnings.push(`Skipped ${rel}: ${result.error}`);
        continue;
      }
      if (seen.has(result.profile.name)) {
        warnings.push(`Duplicate agent name "${result.profile.name}" in ${rel} ignored.`);
        continue;
      }
      seen.add(result.profile.name);
      profiles.push(result.profile);
    }
  }

  return { profiles, warnings };
}

function parseAgentProfile(
  content: string,
  fileName: string,
  workspaceRoot: string,
): { profile?: AgentProfile; error?: string } {
  const { present, data, body } = parseFrontmatter(content);
  if (!present) {
    return { error: 'missing frontmatter block' };
  }

  const name = (data.name || fileName.replace(/\.md$/, '')).trim();
  if (!name) return { error: 'missing agent name' };

  const systemPrompt = body.trim();
  if (!systemPrompt) return { error: 'empty system prompt (no body after frontmatter)' };

  const tools = data.tools
    ? data.tools.split(',').map((t) => t.trim()).filter(Boolean)
    : [...DEFAULT_TOOLS];

  const mode: AgentMode = data.mode === 'primary' ? 'primary' : 'subagent';

  const temperature = data.temperature !== undefined ? parseFloat(data.temperature) : undefined;

  return {
    profile: {
      name,
      description: data.description || `Custom agent: ${name}`,
      mode,
      systemPrompt,
      allowedTools: tools,
      policy: derivePolicy(workspaceRoot, tools),
      temperature: temperature !== undefined && Number.isFinite(temperature) ? temperature : undefined,
    },
  };
}

/** Build a ToolAccessPolicy from a profile's declared tools. */
function derivePolicy(workspaceRoot: string, tools: string[]): ToolAccessPolicy {
  const set = new Set(tools);
  const policy: ToolAccessPolicy = {
    allowedTools: tools,
    terminalAllowed: set.has('run_command'),
  };

  if (set.has('write_file') || set.has('edit_file')) {
    policy.fileWritePaths = [`${workspaceRoot}/**`];
    policy.fileReadPaths = [`${workspaceRoot}/**`];
  }

  const requireApproval: Record<string, boolean> = {};
  for (const t of ['write_file', 'edit_file', 'run_command']) {
    if (set.has(t)) requireApproval[t] = true;
  }
  if (Object.keys(requireApproval).length) {
    policy.requireApproval = requireApproval;
  }

  return policy;
}
