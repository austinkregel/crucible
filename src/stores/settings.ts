import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ProviderInfo {
  id: string;
  name: string;
  models: string[];
  connected?: boolean;
}

export interface RoleConfig {
  provider: string;
  model: string;
}

export interface AdversarialConfig {
  confidenceThreshold: number;
  maxIterations: number;
  postValidation: boolean;
}

export interface IndexStatus {
  state: 'idle' | 'scanning' | 'hashing' | 'indexing' | 'ready' | 'error';
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  changedFiles?: number;
  lastIndexedAt?: number;
  error?: string;
}

export const useSettingsStore = defineStore('settings', () => {
  const providers = ref<ProviderInfo[]>([]);
  const roles = ref<Record<string, RoleConfig>>({
    planner: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250514' },
    executor: { provider: 'ollama', model: 'qwen3:27b' },
    validator: { provider: 'ollama', model: 'qwen3:27b' },
    postValidator: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250514' },
  });
  const adversarial = ref<AdversarialConfig>({
    confidenceThreshold: 0.7,
    maxIterations: 3,
    postValidation: true,
  });
  const indexStatus = ref<IndexStatus>({
    state: 'idle',
    totalFiles: 0,
    processedFiles: 0,
    totalChunks: 0,
  });

  function setProviders(providerList: ProviderInfo[]) {
    providers.value = providerList;
  }

  function setConfig(config: {
    roles: Record<string, RoleConfig>;
    adversarial: AdversarialConfig;
  }) {
    if (config.roles) roles.value = config.roles;
    if (config.adversarial) adversarial.value = config.adversarial;
  }

  function setIndexStatus(status: IndexStatus) {
    indexStatus.value = status;
  }

  function updateRole(role: string, config: RoleConfig) {
    roles.value = { ...roles.value, [role]: config };
  }

  function updateAdversarial(updates: Partial<AdversarialConfig>) {
    adversarial.value = { ...adversarial.value, ...updates };
  }

  return { providers, roles, adversarial, indexStatus, setProviders, setConfig, setIndexStatus, updateRole, updateAdversarial };
});
