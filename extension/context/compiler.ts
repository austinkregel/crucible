import type { CollectedContext, ContextFile } from './collector';
import type { RollingMemory } from '../cache/rollingMemory';
import type { ProjectGrounding } from './projectGrounding';
import { composeSystemPrefix } from './systemPrompt';

export interface CompiledPrompt {
  systemPrefix: string;
  userMessage: string;
  estimatedTokens: number;
}

/**
 * The Context Compiler takes collected context (files, summaries, mentions)
 * and produces a minimal structured prompt that avoids sending full files.
 *
 * Rules:
 * - Never include full files unless absolutely required
 * - Prefer summaries, signatures, small snippets (<=50 lines)
 * - Output: Feature Goal, Relevant Modules, Constraints, Patterns, Code Snippets
 */
export class ContextCompiler {
  private rollingMemory?: RollingMemory;
  private grounding?: ProjectGrounding;

  constructor(rollingMemory?: RollingMemory, grounding?: ProjectGrounding) {
    this.rollingMemory = rollingMemory;
    this.grounding = grounding;
  }

  compile(
    userQuery: string,
    context: CollectedContext,
    additionalInstructions?: string,
  ): CompiledPrompt {
    const systemPrefix = composeSystemPrefix({
      grounding: this.grounding?.toPromptSection(),
      roleInstructions: additionalInstructions,
      rollingMemory: this.rollingMemory?.toPromptSection(),
    });

    const userParts: string[] = [];

    // Feature goal
    userParts.push(`## User Request\n${userQuery}`);

    // Active editor context
    if (context.activeEditor) {
      userParts.push(formatFileContext(context.activeEditor, 'Currently Open File'));
    }

    // Referenced files
    if (context.files.length > 0) {
      const fileContexts = context.files.map((f) =>
        formatFileContext(f, 'Referenced File'),
      );
      userParts.push(`## Referenced Files\n${fileContexts.join('\n\n')}`);
    }

    const userMessage = userParts.join('\n\n');

    const estimatedTokens = Math.ceil((systemPrefix.length + userMessage.length) / 4);

    return { systemPrefix, userMessage, estimatedTokens };
  }

  compileForPlanner(
    userQuery: string,
    context: CollectedContext,
  ): CompiledPrompt {
    return this.compile(userQuery, context, PLANNER_INSTRUCTIONS);
  }

  compileForValidator(
    planJson: string,
    context: CollectedContext,
  ): CompiledPrompt {
    const query = `Critically evaluate this plan:\n\`\`\`json\n${planJson}\n\`\`\`\n\n${VALIDATOR_INSTRUCTIONS}`;
    return this.compile(query, context);
  }

  compileForExecutor(
    stepGoal: string,
    allowedFiles: string[],
    relevantCode: string,
    constraints: string[],
  ): CompiledPrompt {
    const parts = [
      `## Step Goal\n${stepGoal}`,
      `## Allowed Files\n${allowedFiles.join(', ')}`,
      `## Relevant Code\n${relevantCode}`,
      `## Constraints\n${constraints.map((c) => `- ${c}`).join('\n')}`,
      '- Do not duplicate existing logic',
      '- Reuse existing functions where possible',
    ];

    const systemPrefix = composeSystemPrefix({
      base: 'You are a precise code executor. Implement exactly what is asked, nothing more.',
      grounding: this.grounding?.toPromptSection(),
    });

    return {
      systemPrefix,
      userMessage: parts.join('\n\n'),
      estimatedTokens: Math.ceil(parts.join('').length / 4),
    };
  }
}

function formatFileContext(file: ContextFile, label: string): string {
  const header = `### ${label}: ${file.path}${file.language ? ` (${file.language})` : ''}`;
  if (file.summary) {
    return `${header}\n**Summary:** ${file.summary}`;
  }
  if (file.content) {
    return `${header}\n\`\`\`${file.language || ''}\n${file.content}\n\`\`\``;
  }
  return header;
}

const PLANNER_INSTRUCTIONS = `You are the Planner. Your role is to understand the feature intent, identify affected modules, and generate a structured plan.

Respond with valid JSON matching this schema:
{
  "plan": "brief description",
  "steps": [
    {
      "id": "step_1",
      "goal": "what this step accomplishes",
      "files": ["file1.ts", "file2.ts"],
      "risks": ["potential issue"],
      "constraints": ["must not break existing API"]
    }
  ],
  "assumptions": ["assumption about the codebase"]
}

Be thorough but concise. Each step should be independently executable.`;

const VALIDATOR_INSTRUCTIONS = `You are the Adversarial Validator. Your job is to challenge this plan.

Respond with valid JSON:
{
  "issues": ["specific problems with the plan"],
  "missing_cases": ["edge cases not handled"],
  "conflicts": ["conflicts with existing code"],
  "confidence_score": 0.0 to 1.0
}

Be skeptical. Look for:
- Incorrect assumptions
- Existing code that contradicts the plan
- Missing edge cases
- Potential for duplication`;
