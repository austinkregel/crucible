export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  inputPrice?: number;
  outputPrice?: number;
  parameterSize?: string;
  isLocal?: boolean;
  installed?: boolean;
}

export type ModelRole = 'planner' | 'executor' | 'validator' | 'postValidator';

export interface RoleAssignment {
  provider: string;
  model: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  models: string[];

  streamChat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<string, void, undefined>;

  supportsTools(): boolean;

  /** Discover models available from this provider. Updates the models list. */
  discoverModels(): Promise<ModelInfo[]>;

  /** Pull/download a model (only meaningful for local providers like Ollama). */
  pullModel?(
    modelName: string,
    onProgress?: (progress: PullProgress) => void,
  ): Promise<boolean>;

  /** Get models currently loaded in memory (only meaningful for local providers). */
  getRunningModels?(): Promise<RunningModelInfo[]>;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens?: number;
}

export const MODEL_LIMITS: Record<string, ModelLimits> = {
  'gpt-4o': { contextWindow: 128_000, maxOutputTokens: 16_384 },
  'gpt-4o-mini': { contextWindow: 128_000, maxOutputTokens: 16_384 },
  'claude-sonnet-4-5-20250514': { contextWindow: 200_000, maxOutputTokens: 8_192 },
  'claude-opus-4-5-20250514': { contextWindow: 200_000, maxOutputTokens: 8_192 },
  'qwen3:27b': { contextWindow: 32_768 },
  'qwen3:8b': { contextWindow: 32_768 },
  'llama3.1:8b': { contextWindow: 128_000 },
  'deepseek-r1:14b': { contextWindow: 128_000 },
};

export function getModelLimits(model: string): ModelLimits {
  return MODEL_LIMITS[model] ?? { contextWindow: 32_768 };
}

// --- Ollama Diagnostics ---

export interface RunningModelInfo {
  name: string;
  size: number;
  sizeVram: number;
  expiresAt?: string;
}

export enum OllamaErrorKind {
  NotRunning = 'not_running',
  ModelNotFound = 'model_not_found',
  OutOfMemory = 'out_of_memory',
  Timeout = 'timeout',
  Unknown = 'unknown',
}

export class OllamaError extends Error {
  kind: OllamaErrorKind;
  suggestion: string;
  model?: string;

  constructor(kind: OllamaErrorKind, message: string, suggestion: string, model?: string) {
    super(message);
    this.name = 'OllamaError';
    this.kind = kind;
    this.suggestion = suggestion;
    this.model = model;
  }

  static classify(err: any, model?: string): OllamaError {
    const msg = (err?.message || err?.toString() || '').toLowerCase();

    if (msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('network')) {
      return new OllamaError(
        OllamaErrorKind.NotRunning,
        `Cannot connect to Ollama: ${err.message}`,
        'Ensure Ollama is running. Start it with "ollama serve" or check that the configured base URL is correct.',
        model,
      );
    }

    if (msg.includes('not found') || msg.includes('no such model') || msg.includes('does not exist')) {
      return new OllamaError(
        OllamaErrorKind.ModelNotFound,
        `Model "${model}" not found`,
        `Pull the model with "ollama pull ${model}" or use the Pull button in the UI.`,
        model,
      );
    }

    if (msg.includes('out of memory') || msg.includes('insufficient memory') || msg.includes('oom') || msg.includes('not enough memory')) {
      return new OllamaError(
        OllamaErrorKind.OutOfMemory,
        `Out of memory loading "${model}"`,
        'Try a smaller/quantized model, unload other models, or free GPU memory.',
        model,
      );
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('deadline exceeded')) {
      return new OllamaError(
        OllamaErrorKind.Timeout,
        `Request timed out for model "${model}"`,
        'The model may be loading or the system is overloaded. Try again shortly.',
        model,
      );
    }

    return new OllamaError(
      OllamaErrorKind.Unknown,
      err.message || 'Unknown Ollama error',
      'Check Ollama logs for details.',
      model,
    );
  }
}

export interface ProviderDiagnostics {
  providerId: string;
  connected: boolean;
  installedModels: string[];
  runningModels: RunningModelInfo[];
  configuredRoles: Array<{
    role: ModelRole;
    model: string;
    installed: boolean;
    running: boolean;
  }>;
}
