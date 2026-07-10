<script setup lang="ts">
import { ref } from 'vue';

interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'phase' | 'error';
  tool?: string;
  args?: Record<string, any>;
  result?: string;
  status?: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  content?: string;
}

defineProps<{
  entries: ActivityEntry[];
  streamingThinking: string;
}>();

const expanded = ref(true);
const expandedEntries = ref<Set<string>>(new Set());

function toggleEntry(id: string) {
  if (expandedEntries.value.has(id)) {
    expandedEntries.value.delete(id);
  } else {
    expandedEntries.value.add(id);
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusIcon = (status?: string) => {
  switch (status) {
    case 'running': return '⟳';
    case 'completed': return '✓';
    case 'failed': return '✗';
    default: return '•';
  }
};

const statusClass = (status?: string) => {
  switch (status) {
    case 'running': return 'text-yellow-400';
    case 'completed': return 'text-green-400';
    case 'failed': return 'text-red-400';
    default: return 'text-vscode-muted';
  }
};
</script>

<template>
  <div class="border border-vscode-border rounded-md overflow-hidden my-2 text-[11px]">
    <button
      class="w-full flex items-center justify-between px-3 py-1.5 bg-vscode-input-bg hover:bg-vscode-hover text-vscode-fg font-medium text-[11px] cursor-pointer"
      @click="expanded = !expanded"
    >
      <span>Activity Log ({{ entries.length }} events)</span>
      <span class="text-vscode-muted">{{ expanded ? '▼' : '▶' }}</span>
    </button>

    <div v-if="expanded" class="max-h-64 overflow-y-auto">
      <!-- Streaming thinking indicator -->
      <div
        v-if="streamingThinking"
        class="flex items-start gap-2 px-3 py-1 border-t border-vscode-border bg-vscode-editor-bg"
      >
        <span class="text-blue-400 shrink-0">⟳</span>
        <div class="flex-1 min-w-0">
          <span class="text-vscode-muted">Thinking...</span>
          <pre class="mt-0.5 text-[10px] text-vscode-fg whitespace-pre-wrap break-words font-mono max-h-20 overflow-y-auto">{{ streamingThinking.slice(-500) }}</pre>
        </div>
      </div>

      <div
        v-for="entry in entries"
        :key="entry.id"
        class="border-t border-vscode-border"
      >
        <button
          class="w-full flex items-start gap-2 px-3 py-1 hover:bg-vscode-hover cursor-pointer text-left"
          @click="toggleEntry(entry.id)"
        >
          <span :class="statusClass(entry.status)" class="shrink-0 w-3 text-center">
            {{ statusIcon(entry.status) }}
          </span>
          <span class="text-vscode-muted shrink-0">{{ formatTime(entry.timestamp) }}</span>
          <span class="flex-1 min-w-0 truncate text-vscode-fg">
            <template v-if="entry.type === 'tool_call'">
              <span class="font-mono">{{ entry.tool }}</span>
              <span class="text-vscode-muted ml-1" v-if="entry.args?.path">{{ entry.args.path }}</span>
              <span class="text-vscode-muted ml-1" v-else-if="entry.args?.command">$ {{ entry.args.command }}</span>
            </template>
            <template v-else-if="entry.type === 'thinking'">
              <span class="text-blue-400">Thinking</span>
              <span class="text-vscode-muted ml-1">{{ (entry.content || '').slice(0, 60) }}...</span>
            </template>
            <template v-else>
              {{ entry.content || entry.type }}
            </template>
          </span>
          <span v-if="entry.duration_ms" class="text-vscode-muted shrink-0">
            {{ formatDuration(entry.duration_ms) }}
          </span>
          <span class="text-vscode-muted shrink-0">
            {{ expandedEntries.has(entry.id) ? '▼' : '▶' }}
          </span>
        </button>

        <!-- Expanded detail -->
        <div
          v-if="expandedEntries.has(entry.id)"
          class="px-3 py-1.5 bg-vscode-editor-bg border-t border-vscode-border"
        >
          <!-- Tool call args -->
          <div v-if="entry.type === 'tool_call' && entry.args">
            <div class="text-vscode-muted mb-0.5 font-semibold">Arguments:</div>
            <pre class="text-[10px] text-vscode-fg whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">{{ JSON.stringify(entry.args, null, 2) }}</pre>
          </div>

          <!-- Tool result -->
          <div v-if="entry.result" class="mt-1">
            <div class="text-vscode-muted mb-0.5 font-semibold">
              {{ entry.status === 'failed' ? 'Error:' : 'Output:' }}
            </div>
            <pre class="text-[10px] whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto"
              :class="entry.status === 'failed' ? 'text-red-400' : 'text-vscode-fg'"
            >{{ entry.result }}</pre>
          </div>

          <!-- Thinking content -->
          <div v-if="entry.type === 'thinking' && entry.content">
            <pre class="text-[10px] text-vscode-fg whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">{{ entry.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
