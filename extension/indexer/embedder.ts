import { Ollama } from 'ollama';

export interface EmbeddingResult {
  text: string;
  vector: number[];
}

/**
 * Generates embeddings locally via Ollama's embed API.
 * Falls back to a simple hash-based pseudo-embedding when Ollama is unavailable.
 */
export class Embedder {
  private client: Ollama;
  private model: string;
  private dimensions: number;
  private available: boolean | null = null;

  constructor(ollamaBaseUrl: string, model = 'nomic-embed-text', dimensions = 768) {
    this.client = new Ollama({ host: ollamaBaseUrl });
    this.model = model;
    this.dimensions = dimensions;
  }

  async checkAvailability(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const response = await this.client.list();
      const models = response.models || [];
      this.available = models.some((m: any) => {
        const name = m.name || m.model || '';
        return name.startsWith(this.model);
      });
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  async pullModel(onProgress?: (status: string) => void): Promise<boolean> {
    try {
      const stream = await this.client.pull({ model: this.model, stream: true });
      for await (const event of stream) {
        onProgress?.(event.status || 'downloading...');
      }
      this.available = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Embed a batch of texts. Processes in sub-batches to avoid overwhelming Ollama.
   */
  async embedBatch(
    texts: string[],
    batchSize = 32,
    onProgress?: (done: number, total: number) => void,
  ): Promise<EmbeddingResult[]> {
    const isAvailable = await this.checkAvailability();
    if (!isAvailable) {
      return texts.map((text) => ({
        text,
        vector: this.fallbackEmbed(text),
      }));
    }

    const results: EmbeddingResult[] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      try {
        const response = await this.client.embed({
          model: this.model,
          input: batch,
        });

        const embeddings = response.embeddings || [];
        for (let j = 0; j < batch.length; j++) {
          results.push({
            text: batch[j],
            vector: embeddings[j] || this.fallbackEmbed(batch[j]),
          });
        }
      } catch {
        for (const text of batch) {
          results.push({ text, vector: this.fallbackEmbed(text) });
        }
      }

      onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
    }

    return results;
  }

  /** Embed a single text */
  async embed(text: string): Promise<number[]> {
    const isAvailable = await this.checkAvailability();
    if (!isAvailable) return this.fallbackEmbed(text);

    try {
      const response = await this.client.embed({
        model: this.model,
        input: text,
      });
      return response.embeddings?.[0] || this.fallbackEmbed(text);
    } catch {
      return this.fallbackEmbed(text);
    }
  }

  /**
   * Deterministic pseudo-embedding from text for when Ollama is unavailable.
   * Uses character trigram hashing to produce a fixed-size vector.
   * Not semantically meaningful but allows basic deduplication/search.
   */
  private fallbackEmbed(text: string): number[] {
    const vec = new Float32Array(this.dimensions);
    const lower = text.toLowerCase();

    for (let i = 0; i < lower.length - 2; i++) {
      const trigram = lower.substring(i, i + 3);
      let hash = 0;
      for (let j = 0; j < trigram.length; j++) {
        hash = ((hash << 5) - hash + trigram.charCodeAt(j)) | 0;
      }
      const idx = Math.abs(hash) % this.dimensions;
      vec[idx] += 1;
    }

    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;

    return Array.from(vec);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }
}
