<script setup lang="ts">
import { useCostStore } from '../stores/cost';

const costStore = useCostStore();

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
</script>

<template>
  <div
    v-if="costStore.records.length > 0"
    class="flex items-center gap-3 px-3 py-1 text-[10px] text-vscode-muted border-t border-vscode-border shrink-0"
  >
    <span>Tokens: {{ formatTokens(costStore.totalInputTokens) }} in / {{ formatTokens(costStore.totalOutputTokens) }} out</span>
    <span>Cost: {{ formatCost(costStore.totalCost) }}</span>
  </div>
</template>
