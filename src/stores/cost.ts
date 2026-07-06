import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface TokenRecord {
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
}

export const useCostStore = defineStore('cost', () => {
  const records = ref<TokenRecord[]>([]);

  const totalCost = computed(() =>
    records.value.reduce((sum, r) => sum + r.cost, 0),
  );

  const totalInputTokens = computed(() =>
    records.value.reduce((sum, r) => sum + r.inputTokens, 0),
  );

  const totalOutputTokens = computed(() =>
    records.value.reduce((sum, r) => sum + r.outputTokens, 0),
  );

  function addRecord(record: Omit<TokenRecord, 'timestamp'>) {
    records.value.push({ ...record, timestamp: Date.now() });
  }

  function clearRecords() {
    records.value = [];
  }

  return {
    records,
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    addRecord,
    clearRecords,
  };
});
