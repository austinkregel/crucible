import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRegistry } from '../registry';

describe('AgentRegistry.loadUserProfiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-registry-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeAgent(file: string, content: string) {
    const dir = path.join(root, '.claude/agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }

  it('registers a custom subagent and advertises it via spawn_agent descriptions', () => {
    writeAgent('reviewer.md', `---\nname: reviewer\ndescription: Reviews diffs\ntools: read_file\n---\nReview.`);

    const registry = new AgentRegistry(root);
    const warnings = registry.loadUserProfiles();

    expect(warnings).toEqual([]);
    expect(registry.get('reviewer')?.description).toBe('Reviews diffs');
    expect(registry.listSubagents().map((p) => p.name)).toContain('reviewer');
    expect(registry.getSubagentDescriptions()).toContain('reviewer');
  });

  it('warns when a custom profile overrides a built-in name', () => {
    writeAgent('explore.md', `---\nname: explore\ndescription: my explore\ntools: read_file\n---\nExplore.`);

    const registry = new AgentRegistry(root);
    const warnings = registry.loadUserProfiles();

    expect(warnings.some((w) => w.includes('overrides the built-in'))).toBe(true);
    expect(registry.get('explore')?.description).toBe('my explore');
  });

  it('keeps built-ins intact when no user profiles exist', () => {
    const registry = new AgentRegistry(root);
    const warnings = registry.loadUserProfiles();
    expect(warnings).toEqual([]);
    expect(registry.get('build')).toBeDefined();
    expect(registry.get('explore')).toBeDefined();
  });
});
