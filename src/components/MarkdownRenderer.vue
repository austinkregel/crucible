<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';

const props = defineProps<{
  content: string;
}>();

marked.setOptions({
  breaks: true,
  gfm: true,
});

const html = computed(() => {
  if (!props.content) return '';
  try {
    return marked.parse(props.content) as string;
  } catch {
    return props.content;
  }
});
</script>

<template>
  <div class="markdown-body prose prose-sm max-w-none" v-html="html" />
</template>

<style scoped>
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 0.75em;
  margin-bottom: 0.25em;
  font-weight: 600;
  color: var(--vscode-editor-foreground);
}

.markdown-body :deep(h1) { font-size: 1.25em; }
.markdown-body :deep(h2) { font-size: 1.1em; }
.markdown-body :deep(h3) { font-size: 1em; }

.markdown-body :deep(p) {
  margin: 0.4em 0;
  line-height: 1.5;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.4em 0;
}

.markdown-body :deep(li) {
  margin: 0.2em 0;
}

.markdown-body :deep(a) {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--vscode-panel-border);
  padding-left: 0.75em;
  margin: 0.5em 0;
  color: var(--vscode-descriptionForeground);
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--vscode-panel-border);
  padding: 0.3em 0.6em;
  text-align: left;
  font-size: 0.9em;
}

.markdown-body :deep(th) {
  background: var(--vscode-textBlockQuote-background);
}
</style>
