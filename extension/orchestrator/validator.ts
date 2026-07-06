import type { ProviderRegistry } from '../providers/registry';
import type { ChatMessage } from '../providers/types';
import { ContextCompiler } from '../context/compiler';
import type { CollectedContext } from '../context/collector';
import type { Plan, ValidationResult, OrchestratorEventHandler } from './types';

export class Validator {
  constructor(
    private registry: ProviderRegistry,
    private compiler: ContextCompiler,
  ) {}

  async validate(
    plan: Plan,
    context: CollectedContext,
    onEvent?: OrchestratorEventHandler,
  ): Promise<ValidationResult> {
    const roleConfig = this.registry.getByRole('validator');
    if (!roleConfig) {
      throw new Error('No validator model configured. Set crucible.roles.validator in settings.');
    }

    const planJson = JSON.stringify(plan, null, 2);
    const compiled = this.compiler.compileForValidator(planJson, context);

    const messages: ChatMessage[] = [
      { role: 'system', content: compiled.systemPrefix },
      { role: 'user', content: compiled.userMessage },
    ];

    let fullResponse = '';
    const stream = roleConfig.provider.streamChat(messages, {
      model: roleConfig.model,
      temperature: 0.2,
    });

    for await (const token of stream) {
      fullResponse += token;
      onEvent?.({ type: 'streamToken', data: { role: 'validator', token } });
    }

    return parseValidation(fullResponse);
  }

  formatCritique(result: ValidationResult): string {
    const parts: string[] = [];

    if (result.issues.length > 0) {
      parts.push(`Issues:\n${result.issues.map((i) => `- ${i}`).join('\n')}`);
    }
    if (result.missingCases.length > 0) {
      parts.push(`Missing cases:\n${result.missingCases.map((c) => `- ${c}`).join('\n')}`);
    }
    if (result.conflicts.length > 0) {
      parts.push(`Conflicts:\n${result.conflicts.map((c) => `- ${c}`).join('\n')}`);
    }

    return parts.join('\n\n') || 'No issues found.';
  }
}

function parseValidation(response: string): ValidationResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      issues: [],
      missingCases: [],
      conflicts: [],
      confidenceScore: 0.5,
      approved: false,
      raw: response,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const score = typeof parsed.confidence_score === 'number'
      ? parsed.confidence_score
      : 0.5;

    return {
      issues: parsed.issues || [],
      missingCases: parsed.missing_cases || parsed.missingCases || [],
      conflicts: parsed.conflicts || [],
      confidenceScore: Math.max(0, Math.min(1, score)),
      approved: false, // Set by orchestrator based on threshold
      raw: response,
    };
  } catch {
    return {
      issues: ['Failed to parse validation response'],
      missingCases: [],
      conflicts: [],
      confidenceScore: 0.3,
      approved: false,
      raw: response,
    };
  }
}
