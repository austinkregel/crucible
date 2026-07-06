import OpenAI from 'openai';
import type { LLMProvider, ChatMessage, ChatOptions, ModelInfo } from './types';

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';
  models: string[] = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'];

  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const list = await this.client.models.list();
      const discovered: ModelInfo[] = [];
      for await (const model of list) {
        // Only include chat-capable models (filter out embeddings, tts, etc.)
        if (
          model.id.startsWith('gpt-') ||
          model.id.startsWith('o1') ||
          model.id.startsWith('o3') ||
          model.id.startsWith('o4')
        ) {
          discovered.push({
            id: model.id,
            name: model.id,
            installed: true,
          });
        }
      }
      if (discovered.length > 0) {
        // Sort so newest/most common models appear first
        discovered.sort((a, b) => a.id.localeCompare(b.id));
        this.models = discovered.map((m) => m.id);
      }
      return discovered;
    } catch {
      // Keep hardcoded fallbacks
      return this.models.map((id) => ({ id, name: id, installed: true }));
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, undefined> {
    const openaiMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const stream = await this.client.chat.completions.create({
      model: options?.model || this.models[0] || 'gpt-4o',
      messages: openaiMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  supportsTools(): boolean {
    return true;
  }
}
