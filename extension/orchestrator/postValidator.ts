import type { ProviderRegistry } from '../providers/registry';
import type { ChatMessage } from '../providers/types';
import type { Plan, PostValidationResult, ExecutionResult, OrchestratorEventHandler } from './types';

export class PostValidator {
  constructor(private registry: ProviderRegistry) {}

  async validate(
    originalPlan: Plan,
    executionResults: ExecutionResult[],
    onEvent?: OrchestratorEventHandler,
  ): Promise<PostValidationResult> {
    const roleConfig = this.registry.getByRole('postValidator');
    if (!roleConfig) {
      return { approved: true, issues: [], suggestedFixes: [] };
    }

    const prompt = `## Original Plan
\`\`\`json
${JSON.stringify(originalPlan, null, 2)}
\`\`\`

## Implementation Results
${executionResults.map((r) => `### Step ${r.stepId}
${r.success ? 'Success' : 'Failed'}
${r.diff ? `\`\`\`\n${r.diff.substring(0, 2000)}\n\`\`\`` : ''}
${r.error ? `Error: ${r.error}` : ''}
Files changed: ${r.filesChanged.join(', ')}`).join('\n\n')}

## Instructions
Review the implementation against the original plan. Respond with JSON:
{
  "approved": true/false,
  "issues": ["any issues found"],
  "suggested_fixes": ["specific fixes needed"]
}`;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a code reviewer. Validate implementation against the plan.',
      },
      { role: 'user', content: prompt },
    ];

    let fullResponse = '';
    const stream = roleConfig.provider.streamChat(messages, {
      model: roleConfig.model,
      temperature: 0.2,
    });

    for await (const token of stream) {
      fullResponse += token;
      onEvent?.({ type: 'streamToken', data: { role: 'postValidator', token } });
    }

    return parsePostValidation(fullResponse);
  }
}

function parsePostValidation(response: string): PostValidationResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { approved: true, issues: [], suggestedFixes: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      approved: parsed.approved !== false,
      issues: parsed.issues || [],
      suggestedFixes: parsed.suggested_fixes || parsed.suggestedFixes || [],
    };
  } catch {
    return { approved: true, issues: [], suggestedFixes: [] };
  }
}
