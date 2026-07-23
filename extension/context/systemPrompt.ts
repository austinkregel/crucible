/**
 * Single source of truth for the base system prompt and the ordered assembly
 * of the system prefix. Previously the "You are Crucible..." lines were
 * duplicated in ContextCompiler and BudgetCompiler, and each role hand-rolled
 * its own prefix -- so grounding text had to be added in several places or it
 * drifted. Everything now flows through composeSystemPrefix.
 */

export const BASE_SYSTEM_PROMPT = [
  'You are Crucible, an expert AI coding assistant.',
  'You help users understand, modify, and create code.',
  'Be concise, accurate, and reference specific code when relevant.',
].join('\n');

export interface SystemPrefixParts {
  /** Base identity/behavior. Defaults to BASE_SYSTEM_PROMPT when omitted. */
  base?: string;
  /** Project grounding block (## Project Instructions / ## Project Overview). */
  grounding?: string;
  /** Role-specific instructions (planner/validator/etc.). */
  roleInstructions?: string;
  /** Rolling memory / project knowledge section. */
  rollingMemory?: string;
}

/**
 * Assemble the system prefix in a fixed, deliberate order:
 *   base -> grounding -> role instructions -> rolling memory
 *
 * Grounding sits right after the base identity so every role is anchored to
 * the real project before it sees its task-specific instructions. Empty or
 * whitespace-only sections are skipped.
 */
export function composeSystemPrefix(parts: SystemPrefixParts): string {
  const sections = [
    parts.base ?? BASE_SYSTEM_PROMPT,
    parts.grounding,
    parts.roleInstructions,
    parts.rollingMemory,
  ];

  return sections
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s))
    .join('\n\n');
}
