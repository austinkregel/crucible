import { describe, it, expect } from 'vitest';
import { composeSystemPrefix, BASE_SYSTEM_PROMPT } from '../systemPrompt';

describe('composeSystemPrefix', () => {
  it('defaults to the base prompt when nothing else is given', () => {
    expect(composeSystemPrefix({})).toBe(BASE_SYSTEM_PROMPT);
  });

  it('orders base -> grounding -> role -> memory', () => {
    const out = composeSystemPrefix({
      grounding: 'GROUND',
      roleInstructions: 'ROLE',
      rollingMemory: 'MEM',
    });
    expect(out).toBe(`${BASE_SYSTEM_PROMPT}\n\nGROUND\n\nROLE\n\nMEM`);
  });

  it('allows overriding the base', () => {
    expect(composeSystemPrefix({ base: 'X' })).toBe('X');
  });

  it('skips empty and whitespace-only sections', () => {
    const out = composeSystemPrefix({ base: 'A', grounding: '   ', roleInstructions: 'B' });
    expect(out).toBe('A\n\nB');
  });
});
