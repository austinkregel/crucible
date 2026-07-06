<script setup lang="ts">
defineProps<{
  validation: {
    issues: string[];
    missingCases: string[];
    conflicts: string[];
    confidenceScore: number;
    approved: boolean;
  };
}>();

function confidenceColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500';
  if (score >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}
</script>

<template>
  <div class="border border-vscode-border rounded-md overflow-hidden my-2">
    <div class="px-3 py-2 bg-vscode-input-bg border-b border-vscode-border flex items-center justify-between">
      <span class="text-xs font-semibold">Adversarial Validation</span>
      <div class="flex items-center gap-2">
        <div class="w-16 h-1.5 bg-vscode-input-bg rounded-full overflow-hidden border border-vscode-border">
          <div
            :class="['h-full rounded-full transition-all', confidenceColor(validation.confidenceScore)]"
            :style="{ width: `${validation.confidenceScore * 100}%` }"
          />
        </div>
        <span class="text-[10px] text-vscode-muted">
          {{ (validation.confidenceScore * 100).toFixed(0) }}%
        </span>
        <span
          :class="[
            'text-[10px] px-1.5 py-0.5 rounded',
            validation.approved
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          ]"
        >
          {{ validation.approved ? 'Approved' : 'Needs Revision' }}
        </span>
      </div>
    </div>

    <div class="px-3 py-2 space-y-2 text-xs">
      <div v-if="validation.issues.length > 0">
        <span class="text-vscode-error font-medium">Issues</span>
        <ul class="list-disc pl-4 mt-0.5 text-vscode-muted">
          <li v-for="(issue, i) in validation.issues" :key="i">{{ issue }}</li>
        </ul>
      </div>

      <div v-if="validation.missingCases.length > 0">
        <span class="text-vscode-warning font-medium">Missing Cases</span>
        <ul class="list-disc pl-4 mt-0.5 text-vscode-muted">
          <li v-for="(mc, i) in validation.missingCases" :key="i">{{ mc }}</li>
        </ul>
      </div>

      <div v-if="validation.conflicts.length > 0">
        <span class="text-vscode-error font-medium">Conflicts</span>
        <ul class="list-disc pl-4 mt-0.5 text-vscode-muted">
          <li v-for="(c, i) in validation.conflicts" :key="i">{{ c }}</li>
        </ul>
      </div>

      <div v-if="validation.issues.length === 0 && validation.missingCases.length === 0 && validation.conflicts.length === 0">
        <span class="text-vscode-success">No issues found. Plan looks solid.</span>
      </div>
    </div>
  </div>
</template>
