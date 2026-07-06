<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  toolName: string;
  args?: Record<string, any>;
  result?: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  duration_ms?: number;
}>();

const expanded = ref(false);

const toolIcon = computed(() => {
  if (['read_file', 'write_file', 'edit_file', 'list_files'].includes(props.toolName)) return 'file';
  if (props.toolName === 'search_code') return 'search';
  if (props.toolName === 'run_command') return 'terminal';
  return 'tool';
});

const argsSummary = computed(() => {
  if (!props.args) return '';
  if (props.args.path) return props.args.path;
  if (props.args.pattern) return props.args.pattern;
  if (props.args.command) return props.args.command;
  if (props.args.query) return props.args.query;
  return JSON.stringify(props.args);
});

function toggle() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div class="rounded-md border border-vscode-border overflow-hidden text-[11px]">
    <div
      data-testid="tool-header"
      class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-vscode-input-bg/50 transition-colors select-none"
      @click="toggle"
    >
      <!-- Icon -->
      <span data-testid="tool-icon" class="w-4 h-4 flex items-center justify-center text-vscode-muted shrink-0">
        <svg v-if="toolIcon === 'file'" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <svg v-else-if="toolIcon === 'search'" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <svg v-else-if="toolIcon === 'terminal'" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span v-else class="text-[10px]">⚙</span>
      </span>

      <!-- Tool name + args -->
      <span class="font-mono text-vscode-link">{{ toolName }}</span>
      <span v-if="argsSummary" class="text-vscode-muted truncate min-w-0">{{ argsSummary }}</span>

      <!-- Spacer -->
      <span class="flex-1" />

      <!-- Duration -->
      <span v-if="duration_ms !== undefined" class="text-vscode-muted text-[9px]">{{ duration_ms }}ms</span>

      <!-- Status indicator -->
      <span
        v-if="status === 'running'"
        data-testid="status-running"
        class="w-3 h-3 border-2 border-vscode-link border-t-transparent rounded-full animate-spin"
      />
      <span
        v-else-if="status === 'completed'"
        data-testid="status-completed"
        class="text-green-400 text-xs"
      >&#10003;</span>
      <span
        v-else-if="status === 'failed'"
        data-testid="status-failed"
        class="text-red-400 text-xs"
      >&#10007;</span>

      <!-- Expand chevron -->
      <span
        class="text-[9px] text-vscode-muted transition-transform"
        :class="{ 'rotate-90': expanded }"
      >&#9654;</span>
    </div>

    <!-- Error line (always visible) -->
    <div v-if="status === 'failed' && error && !expanded" class="px-2 py-1 bg-red-500/10 text-red-400 text-[10px] border-t border-vscode-border">
      {{ error }}
    </div>

    <!-- Expanded result -->
    <div v-if="expanded" data-testid="tool-result" class="border-t border-vscode-border">
      <div v-if="error" class="px-2 py-1.5 bg-red-500/10 text-red-400">
        {{ error }}
      </div>
      <pre
        v-if="result"
        class="px-2 py-1.5 overflow-x-auto max-h-[300px] overflow-y-auto bg-vscode-input-bg/30 text-vscode-fg font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words m-0 border-0 rounded-none"
      >{{ result }}</pre>
      <div v-if="!result && !error" class="px-2 py-1.5 text-vscode-muted italic">
        No output
      </div>
    </div>
  </div>
</template>
