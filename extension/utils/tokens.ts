// Rough token estimation: ~4 chars per token for English text.
// For accurate counting, a proper tokenizer (tiktoken) could be used,
// but this is sufficient for cost estimates in the UI.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PricingTier {
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k?: number;
}

const PRICING: Record<string, PricingTier> = {
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'claude-sonnet-4-5-20250514': {
    inputPer1k: 0.003,
    outputPer1k: 0.015,
    cachedInputPer1k: 0.0003,
  },
  'claude-opus-4-5-20250514': {
    inputPer1k: 0.015,
    outputPer1k: 0.075,
    cachedInputPer1k: 0.0015,
  },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  const uncachedInput = inputTokens - cachedTokens;
  const cachedCost = cachedTokens * (pricing.cachedInputPer1k ?? pricing.inputPer1k) / 1000;
  return (uncachedInput * pricing.inputPer1k / 1000) + (outputTokens * pricing.outputPer1k / 1000) + cachedCost;
}
