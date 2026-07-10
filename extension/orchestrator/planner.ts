import type { ProviderRegistry } from '../providers/registry';
import type { ChatMessage } from '../providers/types';
import { ContextCompiler } from '../context/compiler';
import type { CollectedContext } from '../context/collector';
import type { Plan, OrchestratorEventHandler } from './types';

export class Planner {
  constructor(
    private registry: ProviderRegistry,
    private compiler: ContextCompiler,
  ) {}

  async generatePlan(
    userQuery: string,
    context: CollectedContext,
    onEvent?: OrchestratorEventHandler,
  ): Promise<Plan> {
    const roleConfig = this.registry.getByRole('planner');
    if (!roleConfig) {
      throw new Error('No planner model configured. Set crucible.roles.planner in settings.');
    }

    const compiled = this.compiler.compileForPlanner(userQuery, context);

    const messages: ChatMessage[] = [
      { role: 'system', content: compiled.systemPrefix },
      { role: 'user', content: compiled.userMessage },
    ];

    let fullResponse = '';
    const stream = roleConfig.provider.streamChat(messages, {
      model: roleConfig.model,
      temperature: 0.3,
    });

    for await (const token of stream) {
      fullResponse += token;
      onEvent?.({ type: 'streamToken', data: { role: 'planner', token } });
    }

    return parsePlan(fullResponse);
  }

  async refinePlan(
    currentPlan: Plan,
    critique: string,
    context: CollectedContext,
    onEvent?: OrchestratorEventHandler,
  ): Promise<Plan> {
    const roleConfig = this.registry.getByRole('planner');
    if (!roleConfig) {
      throw new Error('No planner model configured.');
    }

    const refinementPrompt = `Your previous plan was critiqued. Refine it based on this feedback.

## Previous Plan
\`\`\`json
${JSON.stringify(currentPlan, null, 2)}
\`\`\`

## Critique
${critique}

Generate an improved plan addressing all feedback. Respond with valid JSON matching the same schema.`;

    const compiled = this.compiler.compile(refinementPrompt, context);

    const messages: ChatMessage[] = [
      { role: 'system', content: compiled.systemPrefix },
      { role: 'user', content: compiled.userMessage },
    ];

    let fullResponse = '';
    const stream = roleConfig.provider.streamChat(messages, {
      model: roleConfig.model,
      temperature: 0.3,
    });

    for await (const token of stream) {
      fullResponse += token;
      onEvent?.({ type: 'streamToken', data: { role: 'planner', token } });
    }

    return parsePlan(fullResponse);
  }
}

function parsePlan(response: string): Plan {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      plan: response,
      steps: [],
      assumptions: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      plan: parsed.plan || '',
      steps: (parsed.steps || []).map((s: any, i: number) => ({
        id: s.id || `step_${i + 1}`,
        goal: s.goal || '',
        files: s.files || [],
        risks: s.risks || [],
        constraints: s.constraints || [],
        status: 'pending' as const,
      })),
      assumptions: parsed.assumptions || [],
    };
  } catch {
    return {
      plan: response,
      steps: [],
      assumptions: [],
    };
  }
}
