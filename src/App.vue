<script setup lang="ts">
import { ref } from 'vue';
import ChatPanel from './components/ChatPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';

type View = 'chat' | 'settings';
const currentView = ref<View>('chat');
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null);

function toggleHistory() {
  if (currentView.value !== 'chat') {
    currentView.value = 'chat';
  }
  if (chatPanelRef.value) {
    chatPanelRef.value.showSessionHistory = !chatPanelRef.value.showSessionHistory;
  }
}

function newSession() {
  if (currentView.value !== 'chat') {
    currentView.value = 'chat';
  }
  chatPanelRef.value?.startNewSession();
}
</script>

<template>
  <div class="flex flex-col h-screen w-full">
    <header class="flex items-center px-2 py-1.5 border-b border-vscode-border shrink-0">
      <span class="font-semibold text-xs">Crucible</span>
      <div class="flex items-center gap-1 ml-auto">
        <button
          class="p-1 rounded hover:bg-vscode-hover text-vscode-muted hover:text-vscode-foreground transition-colors"
          title="Session history"
          @click="toggleHistory"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/>
            <path d="M8 3.5a.5.5 0 0 1 .5.5v4l2.854 1.427a.5.5 0 0 1-.448.894l-3.106-1.553A.5.5 0 0 1 7.5 8.5V4a.5.5 0 0 1 .5-.5z"/>
          </svg>
        </button>
        <button
          class="p-1 rounded hover:bg-vscode-hover text-vscode-muted hover:text-vscode-foreground transition-colors"
          title="New session"
          @click="newSession"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 3.5a.5.5 0 0 1 .5.5v3.5H12a.5.5 0 0 1 0 1H8.5V12a.5.5 0 0 1-1 0V8.5H4a.5.5 0 0 1 0-1h3.5V4a.5.5 0 0 1 .5-.5z"/>
          </svg>
        </button>
        <button
          class="p-1 rounded"
          :class="currentView === 'chat'
            ? 'text-vscode-foreground'
            : 'text-vscode-muted hover:text-vscode-foreground'"
          title="Chat"
          @click="currentView = 'chat'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v8A1.5 1.5 0 0 1 13.5 12H5l-4 3v-3H2.5A1.5 1.5 0 0 1 1 10.5v-8zM2.5 2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5H2v2l3-2h8.5a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5h-11z"/>
          </svg>
        </button>
        <button
          class="p-1 rounded"
          :class="currentView === 'settings'
            ? 'text-vscode-foreground'
            : 'text-vscode-muted hover:text-vscode-foreground'"
          title="Settings"
          @click="currentView = 'settings'"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.3.7-2.4.5v1.2l2.4.5.3.7-1.3 2 .8.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V6.8l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM8 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
          </svg>
        </button>
      </div>
    </header>
    <ChatPanel v-if="currentView === 'chat'" ref="chatPanelRef" />
    <SettingsPanel v-else />
  </div>
</template>
