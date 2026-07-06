import { vi, describe, it, expect, beforeEach } from 'vitest';
import { parseMentions, stripMentions } from '../mentions';

describe('parseMentions', () => {
  it('parses a file mention', () => {
    const result = parseMentions('Look at @src/utils.ts for details');
    expect(result).toEqual([
      { type: 'file', value: 'src/utils.ts', raw: '@src/utils.ts' },
    ]);
  });

  it('parses a folder mention', () => {
    const result = parseMentions('Check @src/ directory');
    expect(result).toEqual([
      { type: 'folder', value: 'src/', raw: '@src/' },
    ]);
  });

  it('parses a symbol mention', () => {
    const result = parseMentions('See @ClassName for usage');
    expect(result).toEqual([
      { type: 'symbol', value: 'ClassName', raw: '@ClassName' },
    ]);
  });

  it('parses multiple mentions of different types', () => {
    const result = parseMentions('Use @ClassName from @src/utils.ts in @lib/');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'symbol', value: 'ClassName', raw: '@ClassName' });
    expect(result[1]).toEqual({ type: 'file', value: 'src/utils.ts', raw: '@src/utils.ts' });
    expect(result[2]).toEqual({ type: 'folder', value: 'lib/', raw: '@lib/' });
  });

  it('returns empty array when there are no mentions', () => {
    const result = parseMentions('No mentions here at all');
    expect(result).toEqual([]);
  });
});

describe('stripMentions', () => {
  it('strips mentions and cleans whitespace', () => {
    expect(stripMentions('Fix @src/utils.ts please')).toBe('Fix please');
  });

  it('strips multiple mentions', () => {
    expect(stripMentions('Refactor @ClassName in @src/')).toBe('Refactor in');
  });

  it('returns trimmed input when there are no mentions', () => {
    expect(stripMentions('  hello world  ')).toBe('hello world');
  });

  it('returns empty string when input is only a mention', () => {
    expect(stripMentions('@src/utils.ts')).toBe('');
  });
});
