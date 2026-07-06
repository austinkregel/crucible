import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatMessage, ChatOptions, ModelInfo } from './types';

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  models: string[] = [
    'claude-sonnet-4-5-20250514',
    'claude-opus-4-5-20250514',
    'claude-haiku-3-5-20241022',
  ];

  private client: Anthropic;
  private discoveredModels: ModelInfo[] = [];

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const page = await this.client.models.list({ limit: 100 });
      this.discoveredModels = [];
      for (const model of page.data) {
        const m = model as any;
        this.discoveredModels.push({
          id: m.id,
          name: m.display_name || m.id,
          contextWindow: m.max_input_tokens ?? undefined,
          installed: true,
        });
      }
      if (this.discoveredModels.length > 0) {
        this.models = this.discoveredModels.map((m) => m.id);
      }
      return this.discoveredModels;
    } catch {
      // API key may be invalid or network issue; keep hardcoded fallbacks
      return this.models.map((id) => ({ id, name: id, installed: true }));
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, undefined> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n') || undefined;

    const anthropicMessages = nonSystemMessages.map((m) => ({
      role: (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant',
      content: m.content,
    }));

    const cleaned = ensureAlternating(anthropicMessages);

    const stream = this.client.messages.stream({
      model: options?.model || this.models[0] || 'claude-sonnet-4-5-20250514',
      max_tokens: options?.maxTokens || 4096,
      system: systemPrompt,
      messages: cleaned,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  supportsTools(): boolean {
    return true;
  }
}

function ensureAlternating(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  if (messages.length === 0) return [{ role: 'user' as const, content: '' }];

  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of messages) {
    if (result.length > 0 && result[result.length - 1].role === msg.role) {
      result[result.length - 1].content += '\n\n' + msg.content;
    } else {
      result.push({ ...msg });
    }
  }

  if (result[0].role !== 'user') {
    result.unshift({ role: 'user', content: '(continued)' });
  }

  return result;
}
