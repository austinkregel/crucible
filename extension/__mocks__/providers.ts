import { vi } from 'vitest';

interface LLMProvider {
  readonly id: string;
  readonly name: string;
  models: string[];
  streamChat(messages: any[], options?: any): AsyncGenerator<string, void, undefined>;
  supportsTools(): boolean;
  discoverModels(): Promise<any[]>;
  pullModel?(modelName: string, onProgress?: (p: any) => void): Promise<boolean>;
}

export function createMockProvider(id: string, tokens: string[]): LLMProvider {
  return {
    id,
    name: `Mock ${id}`,
    models: ['model-1'],
    async *streamChat(_messages: any[], _options?: any) {
      for (const token of tokens) {
        yield token;
      }
    },
    supportsTools: vi.fn(() => false),
    discoverModels: vi.fn(async () => [
      { id: 'model-1', name: 'Model 1', installed: true },
    ]),
    pullModel: vi.fn(async () => false),
  };
}

export function createMockRegistry(
  roles: Record<string, { provider: LLMProvider; model: string }>,
) {
  const providers = Object.values(roles).map((r) => r.provider);

  return {
    getByRole: vi.fn((role: string) => roles[role] ?? null),
    get: vi.fn((id: string) => providers.find((p) => p.id === id) ?? null),
    list: vi.fn(() => providers),
    refreshAllModels: vi.fn(async () => new Map()),
    refreshProvider: vi.fn(async () => []),
    pullModel: vi.fn(async () => false),
  };
}
