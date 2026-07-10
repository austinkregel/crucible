<script setup lang="ts">
import type { ChatMessage } from '../stores/chat';
import MarkdownRenderer from './MarkdownRenderer.vue';
import ToolCallBlock from './ToolCallBlock.vue';

defineProps<{
  message: ChatMessage;
}>();

function roleLabel(role: string): string {
  switch (role) {
    case 'user': return 'You';
    case 'assistant': return 'Assistant';
    case 'system': return 'System';
    case 'tool': return 'Tool';
    default: return role;
  }
}

function roleColor(role: string): string {
  switch (role) {
    case 'user': return 'text-vscode-link';
    case 'assistant': return 'text-vscode-success';
    case 'system': return 'text-vscode-warning';
    case 'tool': return 'text-vscode-muted';
    default: return '';
  }
}

function fileName(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || path;
}

function truncateName(name: string, max = 28): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext <= 6) {
    const suffix = name.slice(ext);
    const prefixLen = max - suffix.length - 1;
    return name.slice(0, prefixLen) + '\u2026' + suffix;
  }
  return name.slice(0, max - 1) + '\u2026';
}
</script>

<template>
  <div class="group">
    <!-- Tool messages get rendered as ToolCallBlock -->
    <template v-if="message.role === 'tool' && message.toolName">
      <ToolCallBlock
        :tool-name="message.toolName"
        :args="message.toolArgs"
        :result="message.toolResult"
        :status="message.toolStatus || 'completed'"
        :error="message.role === 'tool' && message.toolStatus === 'failed' ? message.content : undefined"
        :duration_ms="undefined"
      />
    </template>

    <!-- Standard messages -->
    <template v-else>
      <div class="flex items-center gap-2 mb-0.5">
        <span :class="['text-xs font-semibold', roleColor(message.role)]">
          {{ roleLabel(message.role) }}
        </span>
        <span
          v-if="message.model"
          class="text-[10px] px-1 py-0 rounded bg-vscode-badge-bg text-vscode-badge-fg"
        >
          {{ message.model }}
        </span>
        <span class="text-[10px] text-vscode-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {{ new Date(message.timestamp).toLocaleTimeString() }}
        </span>
      </div>
      <div
        :class="[
          'text-sm rounded-md px-3 py-2',
          message.role === 'user'
            ? 'bg-vscode-input-bg'
            : message.role === 'system'
              ? 'bg-vscode-input-bg border border-vscode-warning/30'
              : 'bg-transparent'
        ]"
      >
        <!-- Inline context file pills -->
        <div
          v-if="message.contextFiles && message.contextFiles.length > 0"
          class="flex flex-wrap gap-1 mb-1.5"
        >
          <span
            v-for="(file, i) in message.contextFiles"
            :key="i"
            class="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-vscode-badge-bg/60 text-vscode-link border border-vscode-input-border cursor-default"
            :title="file"
          >
            <svg class="w-3 h-3 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            {{ truncateName(fileName(file)) }}
          </span>
        </div>

        <MarkdownRenderer
          v-if="message.role !== 'user'"
          :content="message.content"
        />
        <p v-else class="whitespace-pre-wrap break-words">{{ message.content }}</p>
      </div>
    </template>
  </div>
</template>
