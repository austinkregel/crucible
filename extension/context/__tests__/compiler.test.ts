import { describe, it, expect, beforeEach } from 'vitest';
import { ContextCompiler } from '../compiler';
import type { CollectedContext } from '../collector';

function emptyContext(): CollectedContext {
  return { files: [], mentions: [] };
}

describe('ContextCompiler', () => {
  let compiler: ContextCompiler;

  beforeEach(() => {
    compiler = new ContextCompiler();
  });

  describe('compile()', () => {
    it('produces systemPrefix with Crucible instruction', () => {
      const result = compiler.compile('hello', emptyContext());
      expect(result.systemPrefix).toContain('Crucible');
    });

    it('produces userMessage with User Request', () => {
      const result = compiler.compile('hello', emptyContext());
      expect(result.userMessage).toContain('User Request');
      expect(result.userMessage).toContain('hello');
    });

    it('returns correct estimatedTokens', () => {
      const result = compiler.compile('hello', emptyContext());
      const expectedTokens = Math.ceil(
        (result.systemPrefix.length + result.userMessage.length) / 4,
      );
      expect(result.estimatedTokens).toBe(expectedTokens);
    });

    it('includes Currently Open File when activeEditor is present', () => {
      const ctx: CollectedContext = {
        files: [],
        mentions: [],
        activeEditor: {
          path: 'src/index.ts',
          content: 'console.log("hi")',
          language: 'typescript',
        },
      };
      const result = compiler.compile('help', ctx);
      expect(result.userMessage).toContain('Currently Open File');
      expect(result.userMessage).toContain('src/index.ts');
    });

    it('includes Referenced Files when files are provided', () => {
      const ctx: CollectedContext = {
        files: [
          { path: 'src/a.ts', content: 'const a = 1;', language: 'typescript' },
        ],
        mentions: [],
      };
      const result = compiler.compile('help', ctx);
      expect(result.userMessage).toContain('Referenced Files');
      expect(result.userMessage).toContain('src/a.ts');
    });

    it('uses summary instead of content when file has summary', () => {
      const ctx: CollectedContext = {
        files: [
          { path: 'src/b.ts', summary: 'Utility functions for strings', language: 'typescript' },
        ],
        mentions: [],
      };
      const result = compiler.compile('help', ctx);
      expect(result.userMessage).toContain('Utility functions for strings');
      expect(result.userMessage).toContain('Summary');
    });

    it('uses content when file has content but no summary', () => {
      const ctx: CollectedContext = {
        files: [
          { path: 'src/c.ts', content: 'export const x = 42;', language: 'typescript' },
        ],
        mentions: [],
      };
      const result = compiler.compile('help', ctx);
      expect(result.userMessage).toContain('export const x = 42;');
    });
  });

  describe('compileForPlanner()', () => {
    it('includes planner instructions in systemPrefix', () => {
      const result = compiler.compileForPlanner('Add feature X', emptyContext());
      expect(result.systemPrefix).toContain('Planner');
      expect(result.systemPrefix).toContain('structured plan');
    });
  });

  describe('compileForValidator()', () => {
    it('includes plan JSON in userMessage', () => {
      const planJson = '{"plan":"test","steps":[]}';
      const result = compiler.compileForValidator(planJson, emptyContext());
      expect(result.userMessage).toContain(planJson);
      expect(result.userMessage).toContain('evaluate this plan');
    });
  });

  describe('compileForExecutor()', () => {
    it('returns executor system prefix', () => {
      const result = compiler.compileForExecutor(
        'Create utility function',
        ['src/utils.ts'],
        'existing code here',
        ['Do not break API'],
      );
      expect(result.systemPrefix).toContain('precise code executor');
    });

    it('includes step goal, files, and constraints in userMessage', () => {
      const result = compiler.compileForExecutor(
        'Create utility function',
        ['src/utils.ts', 'src/helpers.ts'],
        'existing code here',
        ['Do not break API'],
      );
      expect(result.userMessage).toContain('Create utility function');
      expect(result.userMessage).toContain('src/utils.ts');
      expect(result.userMessage).toContain('src/helpers.ts');
      expect(result.userMessage).toContain('Do not break API');
    });
  });

  describe('with RollingMemory', () => {
    it('includes rolling memory in systemPrefix', () => {
      const mockMemory = {
        toPromptSection: () => '## Project Knowledge\n- test',
      };
      const compilerWithMemory = new ContextCompiler(mockMemory as any);
      const result = compilerWithMemory.compile('hello', emptyContext());
      expect(result.systemPrefix).toContain('## Project Knowledge');
      expect(result.systemPrefix).toContain('- test');
    });
  });
});
