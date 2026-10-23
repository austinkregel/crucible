<script setup lang="ts">
import { computed } from 'vue';
import type { AgentLane } from '../stores/agents';
import type { AgentEvent } from '@ext/contracts/protocol';
import type { AgentId } from '@ext/contracts/ids';

const props = defineProps<{
  lane: AgentLane;
}>();

const emit = defineEmits<{
  (e: 'cancel', agentId: AgentId): void;
}>();

const isTerminal = computed(() =>
  ['done', 'failed', 'cancelled'].includes(props.lane.state),
);

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const stateClass = computed(() => {
  switch (props.lane.state) {
    case 'running': return 'text-vscode-link';
    case 'blocked': return 'text-vscode-warning';
    case 'done': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'cancelled': return 'text-vscode-muted';
    default: return 'text-vscode-muted'; // queued
  }
});

/** Best-effort single-line rendering of an agent event (data shape is producer-defined). */
function eventLabel(event: AgentEvent): string {
  const d = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'streamToken':
      return typeof d.token === 'string' ? d.token : String(event.data ?? '');
    case 'toolCallStarted':
      return `▶ ${d.tool ?? 'tool'}`;
    case 'toolCallCompleted':
      return `✓ ${d.tool ?? 'tool'}`;
    case 'toolCallFailed':
      return `✗ ${d.tool ?? 'tool'}: ${d.error ?? 'failed'}`;
    case 'notice':
      return String(d.message ?? event.data ?? '');
    case 'error':
      return String(d.message ?? d.error ?? event.data ?? 'error');
    default:
      return String(event.data ?? '');
  }
}

function eventClass(event: AgentEvent): string {
  switch (event.type) {
    case 'toolCallFailed':
    case 'error': return 'text-red-400';
    case 'toolCallCompleted': return 'text-green-400';
    case 'notice': return 'text-vscode-muted italic';
    default: return 'text-vscode-fg';
  }
}
</script>

<template>
  <div
    data-testid="agent-lane"
    :data-agent-id="lane.ref.agentId"
    class="rounded-md border border-vscode-border overflow-hidden text-[11px]"
  >
    <!-- Identity + lifecycle header -->
    <div class="flex items-center gap-1.5 px-2 py-1.5 bg-vscode-input-bg/40">
      <span
        class="w-2 h-2 rounded-full shrink-0"
        :class="[
          stateClass,
          lane.state === 'running' ? 'bg-current animate-pulse' : 'bg-current',
        ]"
        aria-hidden="true"
      />
      <span data-testid="agent-type" class="font-semibold text-vscode-fg">{{ lane.ref.agentType }}</span>
      <span class="font-mono text-[9px] text-vscode-muted">#{{ shortId(lane.ref.agentId) }}</span>
      <span
        v-if="lane.ref.parentAgentId"
        class="font-mono text-[9px] text-vscode-muted"
        :title="`child of ${lane.ref.parentAgentId}`"
      >↳</span>

      <span class="flex-1" />

      <span data-testid="agent-state" :class="['text-[9px] uppercase tracking-wide', stateClass]">
        {{ lane.state }}
      </span>

      <button
        v-if="!isTerminal"
        data-testid="agent-cancel"
        class="ml-1 px-1.5 py-0.5 rounded text-[9px] text-vscode-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        title="Cancel this agent"
        @click="emit('cancel', lane.ref.agentId)"
      >
        Cancel
      </button>
    </div>

    <!-- Event stream -->
    <div
      v-if="lane.events.length > 0"
      data-testid="agent-events"
      class="px-2 py-1 max-h-40 overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5"
    >
      <div
        v-for="(event, i) in lane.events"
        :key="i"
        data-testid="agent-event"
        :class="['whitespace-pre-wrap break-words', eventClass(event)]"
      >{{ eventLabel(event) }}</div>
    </div>
    <div v-else class="px-2 py-1 text-[10px] text-vscode-muted italic">
      No activity yet.
    </div>
  </div>
</template>
