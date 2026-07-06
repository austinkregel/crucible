<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useVSCode } from '../composables/useVSCode';

const settingsStore = useSettingsStore();
const { postMessage, onMessage } = useVSCode();

onMounted(() => {
  postMessage({ type: 'getProviders' });
  postMessage({ type: 'getConfig' });
});

const isRefreshing = ref(false);
const pullModelName = ref('');
const pullProviderId = ref('ollama');
const isPulling = ref(false);
const pullStatus = ref('');
const pullPercent = ref(0);

const collapsed = ref<Record<string, boolean>>({
  providers: false,
  download: true,
  roles: true,
  adversarial: true,
  index: false,
  cache: true,
});

function toggle(section: string) {
  collapsed.value[section] = !collapsed.value[section];
}

onMessage((msg) => {
  switch (msg.type) {
    case 'providers':
      settingsStore.setProviders(msg.providers);
      isRefreshing.value = false;
      break;
    case 'config':
      settingsStore.setConfig(msg.config);
      break;
    case 'modelsDiscovered':
    case 'allModelsDiscovered':
    case 'modelsError':
      isRefreshing.value = false;
      break;
    case 'indexStatus':
      settingsStore.setIndexStatus(msg.status);
      break;
    case 'pullStart':
      isPulling.value = true;
      pullStatus.value = 'Starting download...';
      pullPercent.value = 0;
      break;
    case 'pullProgress':
      pullStatus.value = msg.progress.status || 'Downloading...';
      if (msg.progress.total && msg.progress.completed) {
        pullPercent.value = Math.round((msg.progress.completed / msg.progress.total) * 100);
      }
      break;
    case 'pullComplete':
      isPulling.value = false;
      pullStatus.value = msg.success ? 'Download complete!' : 'Download failed.';
      pullModelName.value = '';
      setTimeout(() => { pullStatus.value = ''; }, 3000);
      break;
  }
});

function refreshModels(providerId?: string) {
  isRefreshing.value = true;
  postMessage({ type: 'refreshModels', providerId });
}

function pullModel() {
  if (!pullModelName.value.trim()) return;
  postMessage({
    type: 'pullModel',
    providerId: pullProviderId.value,
    modelName: pullModelName.value.trim(),
  });
}

function setApiKey() {
  postMessage({ type: 'setApiKey' });
}

function reindexAll() {
  postMessage({ type: 'reindexAll' });
}

const roleLabels: Record<string, { label: string; icon: string }> = {
  planner: { label: 'Planner', icon: '🧭' },
  executor: { label: 'Executor', icon: '⚡' },
  validator: { label: 'Validator', icon: '🔍' },
  postValidator: { label: 'Reviewer', icon: '✅' },
};

function getModelsForProvider(providerId: string): string[] {
  const provider = settingsStore.providers.find((p) => p.id === providerId);
  return provider?.models || [];
}

function handleRoleProviderChange(role: string, newProvider: string) {
  const models = getModelsForProvider(newProvider);
  const newModel = models[0] || '';
  settingsStore.updateRole(role, { provider: newProvider, model: newModel });
  postMessage({ type: 'updateConfig', roles: { [role]: { provider: newProvider, model: newModel } } });
}

function handleRoleModelChange(role: string, newModel: string) {
  const current = settingsStore.roles[role];
  if (!current) return;
  settingsStore.updateRole(role, { provider: current.provider, model: newModel });
  postMessage({ type: 'updateConfig', roles: { [role]: { provider: current.provider, model: newModel } } });
}

function handleConfidenceChange(value: string) {
  const num = parseFloat(value);
  if (isNaN(num)) return;
  settingsStore.updateAdversarial({ confidenceThreshold: num });
  postMessage({ type: 'updateConfig', adversarial: { confidenceThreshold: num } });
}

function handleMaxIterationsChange(value: string) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 10) return;
  settingsStore.updateAdversarial({ maxIterations: num });
  postMessage({ type: 'updateConfig', adversarial: { maxIterations: num } });
}

function handlePostValidationToggle() {
  const newValue = !settingsStore.adversarial.postValidation;
  settingsStore.updateAdversarial({ postValidation: newValue });
  postMessage({ type: 'updateConfig', adversarial: { postValidation: newValue } });
}

const indexProgressPercent = () => {
  const s = settingsStore.indexStatus;
  if (s.totalFiles <= 0) return 0;
  return Math.round((s.processedFiles / s.totalFiles) * 100);
};
</script>

<template>
  <div class="flex-1 overflow-y-auto px-3 py-3 space-y-2 text-sm">

    <!-- API Key - compact top bar -->
    <div class="flex items-center justify-between p-2.5 rounded-lg bg-vscode-input-bg/50 border border-vscode-border">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-md bg-vscode-button-bg/20 flex items-center justify-center text-[11px]">🔑</div>
        <div>
          <p class="text-xs font-medium">API Keys</p>
          <p class="text-[9px] text-vscode-muted">Stored securely in VSCode secrets</p>
        </div>
      </div>
      <button
        class="bg-vscode-button-bg text-vscode-button-fg px-2.5 py-1 rounded text-[11px] hover:bg-vscode-button-hover"
        @click="setApiKey"
      >
        Set Key
      </button>
    </div>

    <!-- Providers & Models -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('providers')"
      >
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.providers }">▶</span>
          <span class="text-xs font-semibold">Providers & Models</span>
          <span class="text-[9px] px-1.5 py-0 rounded-full bg-vscode-badge-bg text-vscode-badge-fg">
            {{ settingsStore.providers.length }}
          </span>
        </div>
        <button
          :disabled="isRefreshing"
          class="text-[10px] px-2 py-0.5 rounded bg-vscode-input-bg border border-vscode-input-border text-vscode-fg hover:bg-vscode-button-hover disabled:opacity-40"
          @click.stop="refreshModels()"
        >
          {{ isRefreshing ? 'Scanning...' : 'Refresh All' }}
        </button>
      </button>

      <div v-show="!collapsed.providers" class="px-3 py-2 space-y-2">
        <div v-if="settingsStore.providers.length === 0" class="text-[11px] text-vscode-muted py-2 text-center">
          No providers configured. Set an API key or start Ollama.
        </div>

        <div v-for="p in settingsStore.providers" :key="p.id" class="rounded-md border border-vscode-border overflow-hidden">
          <div class="flex items-center justify-between px-2.5 py-1.5 bg-vscode-input-bg/40">
            <div class="flex items-center gap-2">
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :class="p.connected !== false ? 'bg-green-500' : 'bg-red-500'"
              />
              <span class="text-[11px] font-medium">{{ p.name }}</span>
              <span class="text-[9px] px-1 py-0 rounded bg-vscode-badge-bg/70 text-vscode-badge-fg">
                {{ p.models.length }}
              </span>
            </div>
            <button
              :disabled="isRefreshing"
              class="text-[9px] text-vscode-link hover:underline disabled:opacity-40"
              @click="refreshModels(p.id)"
            >
              Refresh
            </button>
          </div>
          <div v-if="p.models.length > 0" class="px-2.5 py-2">
            <div class="flex flex-wrap gap-1">
              <span
                v-for="model in p.models"
                :key="model"
                class="text-[9px] px-1.5 py-0.5 rounded-md bg-vscode-input-bg border border-vscode-border text-vscode-fg font-mono truncate max-w-[180px]"
                :title="model"
              >
                {{ model }}
              </span>
            </div>
          </div>
          <div v-else class="px-2.5 py-2 text-[10px] text-vscode-muted italic">
            {{ p.id === 'ollama' ? 'Ollama not reachable' : 'No models discovered' }}
          </div>
        </div>
      </div>
    </section>

    <!-- Download Model -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('download')"
      >
        <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.download }">▶</span>
        <span class="text-xs font-semibold">Download Model</span>
        <span class="text-[9px] text-vscode-muted ml-auto">Ollama</span>
      </button>

      <div v-show="!collapsed.download" class="px-3 py-2 space-y-2">
        <p class="text-[10px] text-vscode-muted">
          Pull from Ollama's registry (e.g. qwen3:27b, llama3:8b, codellama:13b)
        </p>
        <div class="flex items-center gap-1.5">
          <input
            v-model="pullModelName"
            :disabled="isPulling"
            placeholder="model name"
            class="flex-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-md px-2 py-1.5 text-[11px] min-w-0 focus:outline-none focus:border-vscode-link"
            @keydown.enter="pullModel"
          />
          <button
            :disabled="isPulling || !pullModelName.trim()"
            class="bg-vscode-button-bg text-vscode-button-fg px-3 py-1.5 rounded-md text-[11px] hover:bg-vscode-button-hover disabled:opacity-40 shrink-0"
            @click="pullModel"
          >
            {{ isPulling ? 'Pulling...' : 'Pull' }}
          </button>
        </div>
        <div v-if="isPulling || pullStatus" class="space-y-1">
          <div v-if="isPulling" class="w-full h-1 bg-vscode-input-bg rounded-full overflow-hidden">
            <div
              class="h-full bg-vscode-link rounded-full transition-all duration-300"
              :style="{ width: `${pullPercent}%` }"
            />
          </div>
          <p class="text-[9px] text-vscode-muted">
            {{ pullStatus }}{{ isPulling && pullPercent > 0 ? ` (${pullPercent}%)` : '' }}
          </p>
        </div>
      </div>
    </section>

    <!-- Agent Pipeline -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('roles')"
      >
        <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.roles }">▶</span>
        <span class="text-xs font-semibold">Agent Pipeline</span>
        <span class="text-[9px] text-vscode-muted ml-auto">4 roles</span>
      </button>

      <div v-show="!collapsed.roles" class="px-3 py-2 space-y-2.5">
        <div
          v-for="(config, role) in settingsStore.roles"
          :key="role"
          class="p-2 rounded-md bg-vscode-input-bg/30 space-y-1.5"
        >
          <div class="flex items-center gap-2">
            <span class="text-[11px] w-4 text-center">{{ roleLabels[role]?.icon || '🔧' }}</span>
            <span class="text-[11px] font-medium">{{ roleLabels[role]?.label || role }}</span>
          </div>
          <div class="flex items-center gap-1.5 pl-6">
            <select
              :value="config.provider"
              class="flex-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-md px-1.5 py-1 text-[10px] min-w-0 focus:outline-none focus:border-vscode-link"
              @change="handleRoleProviderChange(role as string, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="p in settingsStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <select
              :value="config.model"
              class="flex-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-md px-1.5 py-1 text-[10px] min-w-0 focus:outline-none focus:border-vscode-link font-mono"
              @change="handleRoleModelChange(role as string, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="m in getModelsForProvider(config.provider)" :key="m" :value="m">{{ m }}</option>
              <option v-if="!getModelsForProvider(config.provider).includes(config.model)" :value="config.model">{{ config.model }}</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- Adversarial Validation -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('adversarial')"
      >
        <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.adversarial }">▶</span>
        <span class="text-xs font-semibold">Adversarial Validation</span>
      </button>

      <div v-show="!collapsed.adversarial" class="px-3 py-2 space-y-3">
        <div class="space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-vscode-muted">Confidence threshold</span>
            <span class="text-[10px] font-mono text-vscode-fg">{{ settingsStore.adversarial.confidenceThreshold.toFixed(2) }}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="settingsStore.adversarial.confidenceThreshold"
            class="w-full h-1 accent-vscode-link cursor-pointer"
            @change="handleConfidenceChange(($event.target as HTMLInputElement).value)"
          />
          <div class="flex justify-between text-[9px] text-vscode-muted">
            <span>0 (permissive)</span>
            <span>1 (strict)</span>
          </div>
        </div>

        <div class="space-y-1">
          <label class="flex items-center justify-between">
            <span class="text-[11px] text-vscode-muted">Max iterations</span>
            <input
              type="number"
              min="1"
              max="10"
              :value="settingsStore.adversarial.maxIterations"
              class="w-14 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-md px-1.5 py-0.5 text-[10px] text-right font-mono focus:outline-none focus:border-vscode-link"
              @change="handleMaxIterationsChange(($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-vscode-muted">Post-validation</span>
          <button
            class="relative w-8 h-4 rounded-full transition-colors"
            :class="settingsStore.adversarial.postValidation ? 'bg-green-500/60' : 'bg-vscode-input-bg border border-vscode-input-border'"
            @click="handlePostValidationToggle"
          >
            <span
              class="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform"
              :class="settingsStore.adversarial.postValidation ? 'translate-x-4' : 'translate-x-0.5'"
            />
          </button>
        </div>
      </div>
    </section>

    <!-- Codebase Index -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('index')"
      >
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.index }">▶</span>
          <span class="text-xs font-semibold">Codebase Index</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="{
              'bg-green-500': settingsStore.indexStatus.state === 'ready',
              'bg-yellow-500 animate-pulse': settingsStore.indexStatus.state === 'indexing',
              'bg-blue-500 animate-pulse': settingsStore.indexStatus.state === 'scanning' || settingsStore.indexStatus.state === 'hashing',
              'bg-red-500': settingsStore.indexStatus.state === 'error',
              'bg-gray-500': settingsStore.indexStatus.state === 'idle',
            }"
          />
          <span class="text-[10px] text-vscode-muted capitalize">{{ settingsStore.indexStatus.state }}</span>
        </div>
      </button>

      <div v-show="!collapsed.index" class="px-3 py-2 space-y-2">
        <!-- Progress bar for indexing -->
        <div v-if="['scanning', 'hashing', 'indexing'].includes(settingsStore.indexStatus.state)" class="space-y-1">
          <div class="w-full h-1.5 bg-vscode-input-bg rounded-full overflow-hidden">
            <div
              class="h-full bg-vscode-link rounded-full transition-all duration-300"
              :style="{ width: `${indexProgressPercent()}%` }"
            />
          </div>
          <div class="flex justify-between text-[9px] text-vscode-muted">
            <span>{{ settingsStore.indexStatus.processedFiles }}/{{ settingsStore.indexStatus.totalFiles }} files</span>
            <span>{{ indexProgressPercent() }}%</span>
          </div>
        </div>

        <!-- Stats grid -->
        <div class="grid grid-cols-2 gap-2">
          <div class="p-2 rounded-md bg-vscode-input-bg/40 text-center">
            <div class="text-sm font-semibold text-vscode-fg">{{ settingsStore.indexStatus.totalChunks }}</div>
            <div class="text-[9px] text-vscode-muted">Chunks</div>
          </div>
          <div class="p-2 rounded-md bg-vscode-input-bg/40 text-center">
            <div class="text-sm font-semibold text-vscode-fg">{{ settingsStore.indexStatus.processedFiles || 0 }}</div>
            <div class="text-[9px] text-vscode-muted">Files</div>
          </div>
        </div>

        <div v-if="settingsStore.indexStatus.lastIndexedAt" class="text-[9px] text-vscode-muted">
          Last indexed: {{ new Date(settingsStore.indexStatus.lastIndexedAt).toLocaleTimeString() }}
        </div>

        <div v-if="settingsStore.indexStatus.error" class="text-[10px] text-red-400 bg-red-500/10 px-2 py-1 rounded">
          {{ settingsStore.indexStatus.error }}
        </div>

        <div class="flex items-center gap-2">
          <button
            :disabled="['scanning', 'hashing', 'indexing'].includes(settingsStore.indexStatus.state)"
            class="flex-1 bg-vscode-input-bg text-vscode-fg border border-vscode-input-border px-3 py-1.5 rounded-md text-[11px] hover:bg-vscode-button-hover disabled:opacity-40 transition-colors"
            @click="reindexAll"
          >
            Re-index Workspace
          </button>
        </div>

        <p class="text-[9px] text-vscode-muted leading-relaxed">
          Tree-sitter AST chunking + local Ollama embeddings in LanceDB
        </p>
      </div>
    </section>

    <!-- Cache -->
    <section class="rounded-lg border border-vscode-border overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-3 py-2 bg-vscode-input-bg/30 hover:bg-vscode-input-bg/50 transition-colors"
        @click="toggle('cache')"
      >
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-vscode-muted transition-transform" :class="{ 'rotate-90': !collapsed.cache }">▶</span>
          <span class="text-xs font-semibold">Cache</span>
        </div>
        <span class="text-[9px] text-vscode-muted font-mono">~/.crucible/</span>
      </button>

      <div v-show="!collapsed.cache" class="px-3 py-2">
        <button
          class="w-full bg-vscode-input-bg text-vscode-fg border border-vscode-input-border px-3 py-1.5 rounded-md text-[11px] hover:bg-vscode-button-hover transition-colors"
          @click="postMessage({ type: 'clearCache' })"
        >
          Clear Cache
        </button>
      </div>
    </section>

  </div>
</template>
