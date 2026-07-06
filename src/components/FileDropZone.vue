<script setup lang="ts">
import { ref } from 'vue';
import { useVSCode } from '../composables/useVSCode';

const emit = defineEmits<{
  filesAdded: [files: string[]];
}>();

const { postMessage } = useVSCode();
const isDragging = ref(false);

function onDragOver(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;

  const uriList = e.dataTransfer?.getData('text/uri-list');
  const textPlain = e.dataTransfer?.getData('text/plain');

  const paths: string[] = [];

  if (uriList) {
    for (const line of uriList.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        try {
          const url = new URL(trimmed);
          if (url.protocol === 'file:') {
            paths.push(decodeURIComponent(url.pathname));
          }
        } catch {
          paths.push(trimmed);
        }
      }
    }
  } else if (textPlain) {
    paths.push(textPlain.trim());
  }

  // Handle files from the OS file picker
  if (e.dataTransfer?.files) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      if (file.name) {
        paths.push(file.name);
      }
    }
  }

  if (paths.length > 0) {
    postMessage({ type: 'addContextFiles', paths });
    emit('filesAdded', paths);
  }
}
</script>

<template>
  <div
    class="relative"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <slot />
    <div
      v-if="isDragging"
      class="absolute inset-0 bg-vscode-button-bg/20 border-2 border-dashed border-vscode-button-bg rounded-md flex items-center justify-center z-10"
    >
      <span class="text-sm text-vscode-button-fg font-medium">Drop files to add context</span>
    </div>
  </div>
</template>
