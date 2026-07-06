<script setup lang="ts">
defineProps<{
  filePath: string;
  additions: number;
  deletions: number;
  diff: string;
}>();

const emit = defineEmits<{
  accept: [];
  reject: [];
}>();
</script>

<template>
  <div class="border border-vscode-border rounded-md overflow-hidden my-1.5">
    <div class="flex items-center justify-between px-2.5 py-1.5 bg-vscode-input-bg border-b border-vscode-border">
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono">{{ filePath }}</span>
        <span class="text-[10px] text-green-400">+{{ additions }}</span>
        <span class="text-[10px] text-red-400">-{{ deletions }}</span>
      </div>
      <div class="flex gap-1">
        <button
          class="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700"
          @click="emit('accept')"
        >
          Accept
        </button>
        <button
          class="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700"
          @click="emit('reject')"
        >
          Reject
        </button>
      </div>
    </div>
    <pre class="text-[11px] p-2.5 m-0 overflow-x-auto bg-transparent border-none font-mono leading-relaxed"><template
      v-for="(line, i) in diff.split('\n')"
      :key="i"
    ><span
        :class="[
          'block',
          line.startsWith('+') ? 'bg-green-500/10 text-green-300'
            : line.startsWith('-') ? 'bg-red-500/10 text-red-300'
            : line.startsWith('@') ? 'text-vscode-link'
            : 'text-vscode-muted'
        ]"
      >{{ line }}</span></template></pre>
  </div>
</template>
