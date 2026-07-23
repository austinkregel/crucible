/**
 * Minimal YAML-frontmatter parser shared by the plan store and the agent
 * profile loader. Handles the scalar `key: value` subset both call sites use;
 * it is deliberately not a full YAML parser.
 */

export interface Frontmatter {
  /** Whether a `---` … `---` block was present at the top of the content. */
  present: boolean;
  /** Scalar key/value pairs from the frontmatter block. */
  data: Record<string, string>;
  /** Everything after the frontmatter block (or the whole input if absent). */
  body: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { present: false, data: {}, body: content };
  }

  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    // Strip matching surrounding quotes from the value, if any.
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[kv[1]] = value;
  }

  return { present: true, data, body: content.slice(match[0].length) };
}
