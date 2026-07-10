export interface Mention {
  type: 'file' | 'symbol' | 'folder';
  value: string;
  raw: string;
}

const MENTION_REGEX = /@([\w./-]+)/g;

/**
 * Parse @-mentions from user input.
 * Supports @filename.ts, @src/utils/, @ClassName patterns.
 */
export function parseMentions(input: string): Mention[] {
  const mentions: Mention[] = [];
  let match;

  while ((match = MENTION_REGEX.exec(input)) !== null) {
    const value = match[1];
    const raw = match[0];

    if (value.endsWith('/')) {
      mentions.push({ type: 'folder', value, raw });
    } else if (value.includes('.') || value.includes('/')) {
      mentions.push({ type: 'file', value, raw });
    } else {
      mentions.push({ type: 'symbol', value, raw });
    }
  }

  return mentions;
}

/**
 * Strip @-mentions from input to get the clean query.
 */
export function stripMentions(input: string): string {
  return input.replace(MENTION_REGEX, '').replace(/\s+/g, ' ').trim();
}
