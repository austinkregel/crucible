import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadAgentProfiles } from '../profileLoader';

describe('loadAgentProfiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-agents-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeAgent(dir: string, file: string, content: string) {
    const abs = path.join(root, dir);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, file), content);
  }

  it('parses a profile and derives a policy from its tools', () => {
    writeAgent(
      '.claude/agents',
      'reviewer.md',
      `---
name: reviewer
description: Reviews diffs
tools: read_file, search_code
temperature: 0.2
---
You are a code reviewer.`,
    );

    const { profiles, warnings } = loadAgentProfiles(root);
    expect(warnings).toEqual([]);
    expect(profiles).toHaveLength(1);

    const p = profiles[0];
    expect(p.name).toBe('reviewer');
    expect(p.mode).toBe('subagent');
    expect(p.allowedTools).toEqual(['read_file', 'search_code']);
    expect(p.temperature).toBe(0.2);
    expect(p.systemPrompt).toBe('You are a code reviewer.');
    expect(p.policy.terminalAllowed).toBe(false);
    expect(p.policy.fileWritePaths).toBeUndefined();
  });

  it('grants write/read paths and approvals when write tools are declared', () => {
    writeAgent(
      '.crucible/agents',
      'builder.md',
      `---
name: builder
tools: read_file, write_file, edit_file, run_command
---
Build things.`,
    );

    const { profiles } = loadAgentProfiles(root);
    const p = profiles[0];
    expect(p.policy.terminalAllowed).toBe(true);
    expect(p.policy.fileWritePaths).toEqual([`${root}/**`]);
    expect(p.policy.requireApproval).toEqual({
      write_file: true,
      edit_file: true,
      run_command: true,
    });
  });

  it('defaults name to filename and tools to read-only', () => {
    writeAgent('.claude/agents', 'scout.md', `---\ndescription: x\n---\nScout the code.`);
    const { profiles } = loadAgentProfiles(root);
    expect(profiles[0].name).toBe('scout');
    expect(profiles[0].allowedTools).toEqual(['read_file', 'list_files', 'search_code']);
  });

  it('warns and skips files without frontmatter or body', () => {
    writeAgent('.claude/agents', 'nofm.md', 'just some notes, no frontmatter');
    writeAgent('.claude/agents', 'empty.md', '---\nname: empty\n---\n   ');

    const { profiles, warnings } = loadAgentProfiles(root);
    expect(profiles).toHaveLength(0);
    expect(warnings.some((w) => w.includes('missing frontmatter'))).toBe(true);
    expect(warnings.some((w) => w.includes('empty system prompt'))).toBe(true);
  });

  it('returns nothing when no agent directories exist', () => {
    const { profiles, warnings } = loadAgentProfiles(root);
    expect(profiles).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
