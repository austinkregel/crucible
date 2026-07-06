<script setup lang="ts">
defineProps<{
  plan: {
    summary: string;
    steps: Array<{
      id: string;
      goal: string;
      files: string[];
      status: 'pending' | 'running' | 'done' | 'failed';
      risks?: string[];
    }>;
    assumptions?: string[];
  };
}>();

const emit = defineEmits<{
  approveStep: [stepId: string];
  rejectStep: [stepId: string];
}>();

function statusIcon(status: string): string {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '◌';
    case 'done': return '●';
    case 'failed': return '✕';
    default: return '○';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'pending': return 'text-vscode-muted';
    case 'running': return 'text-yellow-400';
    case 'done': return 'text-vscode-success';
    case 'failed': return 'text-vscode-error';
    default: return 'text-vscode-muted';
  }
}
</script>

<template>
  <div class="border border-vscode-border rounded-md overflow-hidden my-2">
    <div class="px-3 py-2 bg-vscode-input-bg border-b border-vscode-border">
      <span class="text-xs font-semibold">Plan</span>
      <p class="text-xs text-vscode-muted mt-0.5">{{ plan.summary }}</p>
    </div>

    <div class="divide-y divide-vscode-border">
      <div
        v-for="step in plan.steps"
        :key="step.id"
        class="px-3 py-2"
      >
        <div class="flex items-start gap-2">
          <span :class="['text-sm mt-0.5', statusColor(step.status)]">
            {{ statusIcon(step.status) }}
          </span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium">{{ step.goal }}</p>
            <div v-if="step.files.length > 0" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="file in step.files"
                :key="file"
                class="text-[10px] px-1.5 py-0.5 rounded bg-vscode-badge-bg text-vscode-badge-fg"
              >
                {{ file }}
              </span>
            </div>
            <div v-if="step.risks && step.risks.length > 0" class="mt-1">
              <span
                v-for="risk in step.risks"
                :key="risk"
                class="text-[10px] text-vscode-warning block"
              >
                ⚠ {{ risk }}
              </span>
            </div>
          </div>
          <div v-if="step.status === 'pending'" class="flex gap-1 shrink-0">
            <button
              class="text-[10px] px-1.5 py-0.5 rounded bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover"
              @click="emit('approveStep', step.id)"
            >
              Run
            </button>
            <button
              class="text-[10px] px-1.5 py-0.5 rounded border border-vscode-input-border text-vscode-muted hover:text-vscode-fg"
              @click="emit('rejectStep', step.id)"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="plan.assumptions && plan.assumptions.length > 0" class="px-3 py-2 border-t border-vscode-border bg-vscode-input-bg">
      <span class="text-[10px] text-vscode-muted font-semibold uppercase">Assumptions</span>
      <ul class="text-[10px] text-vscode-muted mt-0.5 list-disc pl-4">
        <li v-for="(a, i) in plan.assumptions" :key="i">{{ a }}</li>
      </ul>
    </div>
  </div>
</template>
