import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
  it('parses key/value pairs and returns the body', () => {
    const { present, data, body } = parseFrontmatter('---\nname: x\ndescription: hi\n---\nBODY HERE');
    expect(present).toBe(true);
    expect(data).toEqual({ name: 'x', description: 'hi' });
    expect(body).toBe('BODY HERE');
  });

  it('reports absent frontmatter and returns the whole input as body', () => {
    const { present, data, body } = parseFrontmatter('no frontmatter here');
    expect(present).toBe(false);
    expect(data).toEqual({});
    expect(body).toBe('no frontmatter here');
  });

  it('strips surrounding quotes from values', () => {
    const { data } = parseFrontmatter('---\na: "quoted"\nb: \'single\'\n---\n');
    expect(data.a).toBe('quoted');
    expect(data.b).toBe('single');
  });

  it('ignores non key:value lines in the block', () => {
    const { data } = parseFrontmatter('---\nname: ok\njust a comment\n---\nbody');
    expect(data).toEqual({ name: 'ok' });
  });
});
