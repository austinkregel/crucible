<script setup lang="ts">
import type { AgentPhase } from '../stores/chat';

const props = defineProps<{
  currentPhase: AgentPhase | null;
}>();

const phases: { key: AgentPhase; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'validation', label: 'Validation' },
  { key: 'execution', label: 'Execution' },
  { key: 'postValidation', label: 'Review' },
];

const phaseOrder = ['planning', 'validation', 'execution', 'postValidation'];

function phaseClass(key: AgentPhase): string[] {
  const currentIdx = props.currentPhase ? phaseOrder.indexOf(props.currentPhase) : -1;
  const thisIdx = phaseOrder.indexOf(key);
  const classes: string[] = [];

  if (key === props.currentPhase) {
    classes.push('phase-active');
  } else if (currentIdx > thisIdx) {
    classes.push('phase-done');
  }

  return classes;
}
</script>

<template>
  <div class="flex items-center gap-1 px-2 py-1.5 text-[10px]">
    <template v-for="(phase, i) in phases" :key="phase.key">
      <div
        :data-phase="phase.key"
        :class="[
          'flex items-center gap-1 px-1.5 py-0.5 rounded',
          ...phaseClass(phase.key),
          phase.key === currentPhase
            ? 'bg-vscode-badge-bg text-vscode-badge-fg font-medium'
            : phaseClass(phase.key).includes('phase-done')
              ? 'text-green-400'
              : 'text-vscode-muted'
        ]"
      >
        <span
          v-if="phase.key === currentPhase"
          class="w-1.5 h-1.5 rounded-full bg-current animate-pulse"
        />
        <span v-else-if="phaseClass(phase.key).includes('phase-done')" class="text-[9px]">&#10003;</span>
        <span>{{ phase.label }}</span>
      </div>
      <span v-if="i < phases.length - 1" class="text-vscode-muted">&#8250;</span>
    </template>
  </div>
</template>
