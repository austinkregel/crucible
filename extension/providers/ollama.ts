import { Ollama } from 'ollama';
import type { LLMProvider, ChatMessage, ChatOptions, ModelInfo, PullProgress, RunningModelInfo } from './types';
import { OllamaError, OllamaErrorKind } from './types';

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  models: string[] = [];
  connected = false;

  private client: Ollama;
  private discoveredModels: ModelInfo[] = [];

  constructor(baseUrl: string) {
    this.client = new Ollama({ host: baseUrl });
  }

  async discoverModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.list();
      this.discoveredModels = (response.models || []).map((m: any) => ({
        id: m.name || m.model,
        name: m.name || m.model,
        parameterSize: m.details?.parameter_size,
        isLocal: true,
        installed: true,
      }));
      this.models = this.discoveredModels.map((m) => m.id);
      this.connected = true;
      return this.discoveredModels;
    } catch (err: any) {
      this.connected = false;
      this.discoveredModels = [];
      this.models = [];
      return [];
    }
  }

  async getRunningModels(): Promise<RunningModelInfo[]> {
    try {
      const response = await this.client.ps();
      const models = (response as any).models || [];
      return models.map((m: any) => ({
        name: m.name || m.model,
        size: m.size || 0,
        sizeVram: m.size_vram || 0,
        expiresAt: m.expires_at,
      }));
    } catch {
      return [];
    }
  }

  async ensureModelReady(model: string): Promise<{ ready: boolean; error?: OllamaError }> {
    // Check connection first
    if (!this.connected) {
      try {
        await this.discoverModels();
      } catch {
        // discoverModels already handles setting connected = false
      }
    }

    if (!this.connected) {
      return {
        ready: false,
        error: new OllamaError(
          OllamaErrorKind.NotRunning,
          'Cannot connect to Ollama',
          'Ensure Ollama is running. Start it with "ollama serve" or check that the configured base URL is correct.',
          model,
        ),
      };
    }

    // Check if model is installed
    if (this.models.length > 0 && !this.models.some((m) => m === model || m.startsWith(model + ':'))) {
      return {
        ready: false,
        error: new OllamaError(
          OllamaErrorKind.ModelNotFound,
          `Model "${model}" is not installed`,
          `Pull the model with "ollama pull ${model}" or use the Pull button in the UI.`,
          model,
        ),
      };
    }

    return { ready: true };
  }

  async pullModel(
    modelName: string,
    onProgress?: (progress: PullProgress) => void,
  ): Promise<boolean> {
    try {
      const stream = await this.client.pull({ model: modelName, stream: true });
      for await (const event of stream) {
        onProgress?.({
          status: event.status,
          digest: event.digest,
          total: event.total,
          completed: event.completed,
        });
      }
      await this.discoverModels();
      return true;
    } catch {
      return false;
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, undefined> {
    const model = options?.model || this.models[0] || 'qwen3:27b';

    // Pre-flight check
    const preflight = await this.ensureModelReady(model);
    if (!preflight.ready) {
      throw preflight.error!;
    }

    const ollamaMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    let response: AsyncIterable<any>;
    try {
      response = await this.client.chat({
        model,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      });
    } catch (err: any) {
      throw OllamaError.classify(err, model);
    }

    try {
      for await (const chunk of response) {
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
      }
    } catch (err: any) {
      throw OllamaError.classify(err, model);
    }
  }

  supportsTools(): boolean {
    return false;
  }
}
