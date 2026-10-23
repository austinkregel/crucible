<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PendingQuestion } from '../stores/agents';
import type { AgentAnswer } from '@ext/contracts/protocol';
import type { QuestionId } from '@ext/contracts/ids';

const props = defineProps<{
  pending: PendingQuestion;
}>();

// Emit rather than touch the store directly, so the component stays pure & unit-testable.
const emit = defineEmits<{
  (e: 'answer', payload: { id: QuestionId; answer: AgentAnswer }): void;
}>();

const textValue = ref('');

const question = computed(() => props.pending.question);
const ref_ = computed(() => props.pending.question.ref);
const options = computed(() => props.pending.question.options ?? []);

/** Short, human-scannable agent id for attribution. */
function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function answerWithChoice(choice: string) {
  // Approval kind: map the first option to allowed=true; the payload still carries `choice`
  // so the host can honor either the approval fast-path or the generic choice path.
  const answer: AgentAnswer =
    question.value.kind === 'approval'
      ? { choice, remember: false }
      : { choice };
  emit('answer', { id: props.pending.id, answer });
}

function submitText() {
  if (!textValue.value.trim()) return;
  emit('answer', { id: props.pending.id, answer: { text: textValue.value } });
}
</script>

<template>
  <div
    data-testid="question-prompt"
    class="rounded-md border border-vscode-warning/40 bg-vscode-warning/5 px-3 py-2 text-[11px]"
  >
    <!-- Attribution: which agent is asking -->
    <div class="flex items-center gap-1.5 mb-1.5">
      <span
        class="w-1.5 h-1.5 rounded-full bg-vscode-warning animate-pulse shrink-0"
        aria-hidden="true"
      />
      <span data-testid="question-agent" class="font-semibold text-vscode-warning">
        {{ ref_.agentType }}
      </span>
      <span class="font-mono text-[9px] text-vscode-muted">#{{ shortId(ref_.agentId) }}</span>
      <span class="text-[9px] uppercase tracking-wide text-vscode-muted ml-auto">
        {{ question.kind }}
      </span>
    </div>

    <!-- The prompt -->
    <p data-testid="question-prompt-text" class="text-vscode-fg mb-2 whitespace-pre-wrap break-words">
      {{ question.prompt }}
    </p>

    <!-- approval / choice: option buttons -->
    <div
      v-if="question.kind === 'approval' || question.kind === 'choice'"
      class="flex flex-wrap gap-1.5"
    >
      <button
        v-for="(opt, i) in options"
        :key="opt"
        data-testid="question-option"
        class="px-2.5 py-1 rounded font-medium transition-colors"
        :class="
          question.kind === 'approval' && i === 0
            ? 'bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover'
            : 'border border-vscode-border text-vscode-fg hover:bg-vscode-input-bg'
        "
        @click="answerWithChoice(opt)"
      >
        {{ opt }}
      </button>
    </div>

    <!-- text: input + submit -->
    <form
      v-else
      class="flex items-center gap-1.5"
      @submit.prevent="submitText"
    >
      <input
        v-model="textValue"
        data-testid="question-text-input"
        type="text"
        placeholder="Type your answer..."
        class="flex-1 min-w-0 px-2 py-1 rounded bg-vscode-input-bg border border-vscode-input-border text-vscode-fg outline-none focus:border-vscode-link"
      />
      <button
        type="button"
        data-testid="question-submit"
        @click="submitText"
        class="px-2.5 py-1 rounded font-medium bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover transition-colors"
      >
        Send
      </button>
    </form>
  </div>
</template>
