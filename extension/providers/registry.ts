import * as vscode from 'vscode';
import type { LLMProvider, ModelRole, ModelInfo, RoleAssignment, PullProgress, ProviderDiagnostics, RunningModelInfo } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();

  async initialize(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('crucible');

    const openaiKey = await context.secrets.get('crucible.openaiApiKey');
    if (openaiKey) {
      const baseUrl = config.get<string>('providers.openai.baseUrl') || undefined;
      this.providers.set('openai', new OpenAIProvider(openaiKey, baseUrl));
    }

    const anthropicKey = await context.secrets.get('crucible.anthropicApiKey');
    if (anthropicKey) {
      this.providers.set('anthropic', new AnthropicProvider(anthropicKey));
    }

    const ollamaBaseUrl = config.get<string>('providers.ollama.baseUrl') || 'http://localhost:11434';
    this.providers.set('ollama', new OllamaProvider(ollamaBaseUrl));

    // Run discovery in parallel for all providers, but don't block init on failure
    await this.refreshAllModels();
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  list(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getByRole(role: ModelRole): { provider: LLMProvider; model: string } | undefined {
    const config = vscode.workspace.getConfiguration('crucible');
    const assignment = config.get<RoleAssignment>(`roles.${role}`);
    if (!assignment) return undefined;

    const provider = this.providers.get(assignment.provider);
    if (!provider) return undefined;

    return { provider, model: assignment.model };
  }

  /** Refresh model lists from all providers via their discovery APIs */
  async refreshAllModels(): Promise<Map<string, ModelInfo[]>> {
    const results = new Map<string, ModelInfo[]>();

    const tasks = Array.from(this.providers.entries()).map(
      async ([id, provider]) => {
        try {
          const models = await provider.discoverModels();
          results.set(id, models);
        } catch {
          results.set(id, provider.models.map((m) => ({ id: m, name: m, installed: true })));
        }
      },
    );

    await Promise.allSettled(tasks);
    return results;
  }

  /** Refresh models for a single provider */
  async refreshProvider(providerId: string): Promise<ModelInfo[]> {
    const provider = this.providers.get(providerId);
    if (!provider) return [];
    try {
      return await provider.discoverModels();
    } catch {
      return provider.models.map((m) => ({ id: m, name: m, installed: true }));
    }
  }

  /** Pull a model on a provider that supports it (e.g. Ollama) */
  async pullModel(
    providerId: string,
    modelName: string,
    onProgress?: (progress: PullProgress) => void,
  ): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (!provider?.pullModel) return false;
    return provider.pullModel(modelName, onProgress);
  }

  /** Get diagnostics for a provider (connection, running models, role readiness) */
  async diagnose(providerId: string): Promise<ProviderDiagnostics> {
    const provider = this.providers.get(providerId);
    const config = vscode.workspace.getConfiguration('crucible');
    const allRoles: ModelRole[] = ['planner', 'executor', 'validator', 'postValidator'];

    if (!provider) {
      return {
        providerId,
        connected: false,
        installedModels: [],
        runningModels: [],
        configuredRoles: [],
      };
    }

    // Refresh connection status
    await provider.discoverModels();
    const connected = (provider as any).connected ?? true;
    const installedModels = provider.models;

    let runningModels: RunningModelInfo[] = [];
    if (provider.getRunningModels) {
      runningModels = await provider.getRunningModels();
    }

    const runningNames = new Set(runningModels.map((m) => m.name));

    const configuredRoles = allRoles
      .map((role) => {
        const assignment = config.get<RoleAssignment>(`roles.${role}`);
        if (!assignment || assignment.provider !== providerId) return null;
        return {
          role,
          model: assignment.model,
          installed: installedModels.some((m) => m === assignment.model || m.startsWith(assignment.model + ':')),
          running: runningNames.has(assignment.model) || [...runningNames].some((n) => n.startsWith(assignment.model + ':')),
        };
      })
      .filter(Boolean) as ProviderDiagnostics['configuredRoles'];

    return {
      providerId,
      connected,
      installedModels,
      runningModels,
      configuredRoles,
    };
  }
}
