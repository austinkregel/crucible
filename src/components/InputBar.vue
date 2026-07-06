<script setup lang="ts">
import { ref, computed } from 'vue';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { useVSCode } from '../composables/useVSCode';
import PopoverSelect from './PopoverSelect.vue';
import type { PopoverOption } from './PopoverSelect.vue';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { postMessage } = useVSCode();

const props = defineProps<{
  disabled?: boolean;
  showStop?: boolean;
  contextFiles: string[];
  currentModels: string[];
}>();

const emit = defineEmits<{
  send: [text: string];
  stop: [];
  providerChange: [id: string];
  filesAdded: [files: string[]];
  removeFile: [index: number];
}>();

const inputText = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isDragging = ref(false);
let dragCounter = 0;

// --- Options for popovers ---

const modeOptions: PopoverOption[] = [
  { id: 'ask', label: 'Ask', icon: '\u{1F4AC}' },
  { id: 'plan', label: 'Plan', icon: '\u{1F4D0}' },
  { id: 'agent', label: 'Agent', icon: '\u{221E}' },
];

const providerOptions = computed<PopoverOption[]>(() => {
  const opts = settingsStore.providers.map((p) => ({
    id: p.id,
    label: p.name,
  }));
  if (opts.length === 0) {
    opts.push({ id: 'ollama', label: 'Ollama' });
  }
  return opts;
});

const modelOptions = computed<PopoverOption[]>(() => {
  return props.currentModels.map((m) => ({ id: m, label: m }));
});

// --- Handlers ---

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    cycleMode();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}

const modeOrder = ['ask', 'plan', 'agent'] as const;

function cycleMode() {
  const currentIndex = modeOrder.indexOf(chatStore.mode as typeof modeOrder[number]);
  const nextIndex = (currentIndex + 1) % modeOrder.length;
  chatStore.setMode(modeOrder[nextIndex]);
}

function submit() {
  const text = inputText.value.trim();
  if (!text) return;
  emit('send', text);
  inputText.value = '';
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
  }
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function browseFiles() {
  postMessage({ type: 'browseFiles' });
}

function onModeChange(val: string) {
  chatStore.setMode(val as 'ask' | 'plan' | 'agent');
}

function onProviderChange(val: string) {
  emit('providerChange', val);
}

function onModelChange(val: string) {
  chatStore.setProvider(chatStore.selectedProvider, val);
}

// --- Drag and drop ---

function onDragEnter(e: DragEvent) {
  e.preventDefault();
  dragCounter++;
  isDragging.value = true;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function onDragLeave() {
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragging.value = false;
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  isDragging.value = false;

  const paths: string[] = [];
  const uriList = e.dataTransfer?.getData('text/uri-list') || '';
  const textPlain = e.dataTransfer?.getData('text/plain') || '';

  if (uriList) {
    for (const line of uriList.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      try {
        const url = new URL(trimmed);
        if (url.protocol === 'file:') paths.push(decodeURIComponent(url.pathname));
        else paths.push(trimmed);
      } catch {
        paths.push(trimmed);
      }
    }
  }

  if (paths.length === 0 && textPlain) {
    for (const line of textPlain.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (line.includes('/') || line.includes('\\') || line.includes('.')) paths.push(line);
    }
  }

  if (paths.length === 0 && e.dataTransfer?.files?.length) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i];
      if (f.name) paths.push(f.name);
    }
  }

  if (paths.length > 0) emit('filesAdded', paths);
}

function fileName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || path;
}
</script>

<template>
  <div
    class="shrink-0 mx-2 mb-2 rounded-2xl border transition-colors duration-150 overflow-visible"
    :class="[
      isDragging
        ? 'border-vscode-link/50 bg-vscode-link/5'
        : 'border-vscode-border bg-vscode-input-bg'
    ]"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- File badges -->
    <div
      v-if="contextFiles.length > 0"
      class="flex flex-wrap gap-1 px-3.5 pt-3 pb-0"
    >
      <span
        v-for="(file, i) in contextFiles"
        :key="i"
        class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-vscode-badge-bg text-vscode-link border border-vscode-input-border"
        :title="file"
      >
        <svg class="w-2.5 h-2.5 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        {{ fileName(file) }}
        <button
          class="hover:text-vscode-error ml-0.5 text-vscode-muted"
          @click="emit('removeFile', i)"
        >&times;</button>
      </span>
    </div>

    <!-- Textarea -->
    <textarea
      ref="textareaRef"
      v-model="inputText"
      :disabled="disabled"
      placeholder="Plan, Build, / for commands, @ for context"
      rows="1"
      class="w-full bg-transparent text-vscode-input-fg px-3.5 pt-3 pb-1 text-sm resize-none focus:outline-none min-h-[36px] max-h-[200px] leading-relaxed"
      @keydown="handleKeydown"
      @input="autoResize"
    />

    <!-- Bottom bar: pills left, icons right -->
    <div class="flex items-center justify-between px-2.5 pb-2.5 pt-0.5">
      <!-- Left: mode + provider + model pills -->
      <div class="flex items-center gap-1.5">
        <!-- Mode -->
        <PopoverSelect
          :options="modeOptions"
          :model-value="chatStore.mode"
          pill-class="bg-vscode-badge-bg/70 text-vscode-badge-fg rounded-full px-2.5 py-1 font-medium"
          @update:model-value="onModeChange"
        />

        <!-- Provider + Model (Ask mode only) -->
        <template v-if="chatStore.mode === 'ask'">
          <PopoverSelect
            :options="providerOptions"
            :model-value="chatStore.selectedProvider"
            pill-class="bg-vscode-badge-bg/70 text-vscode-badge-fg rounded-full px-2.5 py-1 font-medium"
            @update:model-value="onProviderChange"
          />

          <PopoverSelect
            :options="modelOptions"
            :model-value="chatStore.selectedModel"
            placeholder="Select model"
            pill-class="bg-transparent text-vscode-muted rounded-full px-1.5 py-1"
            @update:model-value="onModelChange"
          />
        </template>
        <span v-else-if="chatStore.mode === 'plan'" class="text-[11px] text-vscode-muted">
          Multi-agent planning (read-only)
        </span>
        <span v-else class="text-[11px] text-vscode-muted">
          Full agent pipeline
        </span>
      </div>

      <!-- Right: icons -->
      <div class="flex items-center gap-1">
        <!-- Attach -->
        <button
          class="p-1.5 rounded-lg text-vscode-muted hover:text-vscode-fg hover:bg-vscode-bg transition-colors"
          title="Attach files"
          @click="browseFiles"
        >
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
        </button>

        <!-- Stop -->
        <button
          v-if="showStop"
          class="p-1.5 rounded-lg transition-colors text-red-400 bg-red-500/20 hover:bg-red-500/30"
          title="Stop generation"
          @click="$emit('stop')"
        >
          <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>

        <!-- Send -->
        <button
          v-else
          :disabled="disabled || !inputText.trim()"
          class="p-1.5 rounded-lg transition-colors"
          :class="[
            inputText.trim()
              ? 'text-vscode-button-fg bg-vscode-button-bg hover:bg-vscode-button-hover'
              : 'text-vscode-muted cursor-not-allowed'
          ]"
          title="Send"
          @click="submit"
        >
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
