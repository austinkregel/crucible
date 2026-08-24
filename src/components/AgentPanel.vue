<script setup lang="ts">
import { computed } from 'vue';
import { useAgentsStore } from '../stores/agents';
import AgentLane from './AgentLane.vue';
import QuestionPrompt from './QuestionPrompt.vue';
import type { AgentAnswer } from '@ext/contracts/protocol';
import type { AgentId, QuestionId } from '@ext/contracts/ids';

const agents = useAgentsStore();

// Show the panel whenever there is any agent activity or a pending question.
const visible = computed(
  () => agents.laneList.length > 0 || agents.pendingQuestions.length > 0,
);

const waitingLabel = computed(() => {
  const n = agents.waitingAgentCount;
  if (n === 0) return '';
  return `${n} agent${n === 1 ? '' : 's'} waiting on you`;
});

function onAnswer(payload: { id: QuestionId; answer: AgentAnswer }) {
  agents.answerQuestion(payload.id, payload.answer);
}

function onCancelAgent(agentId: AgentId) {
  agents.cancelAgent(agentId);
}
</script>

<template>
  <div
    v-if="visible"
    data-testid="agent-panel"
    class="rounded-lg border border-vscode-border bg-vscode-input-bg/30 p-2 space-y-2 mx-1"
  >
    <!-- Pending questions banner + prompts -->
    <div v-if="agents.pendingQuestions.length > 0" class="space-y-1.5">
      <div
        data-testid="waiting-banner"
        class="flex items-center gap-1.5 text-[11px] font-semibold text-vscode-warning"
      >
        <span class="w-2 h-2 rounded-full bg-vscode-warning animate-pulse" aria-hidden="true" />
        {{ waitingLabel }}
      </div>
      <QuestionPrompt
        v-for="q in agents.pendingQuestions"
        :key="q.id"
        :pending="q"
        @answer="onAnswer"
      />
    </div>

    <!-- Active agent lanes -->
    <div v-if="agents.laneList.length > 0" class="space-y-1.5">
      <div class="text-[10px] uppercase tracking-wide text-vscode-muted px-0.5">
        Agents ({{ agents.activeLanes.length }} active / {{ agents.laneList.length }})
      </div>
      <AgentLane
        v-for="lane in agents.laneList"
        :key="lane.ref.agentId"
        :lane="lane"
        @cancel="onCancelAgent"
      />
    </div>
  </div>
</template>
