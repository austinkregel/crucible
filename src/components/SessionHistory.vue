<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useVSCode } from '../composables/useVSCode';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'load-session', id: string): void;
}>();

const { postMessage, onMessage } = useVSCode();

interface SessionSummary {
  id: string;
  title: string;
  mode?: string;
  updatedAt: number;
}

const sessions = ref<SessionSummary[]>([]);
const archivedSessions = ref<SessionSummary[]>([]);
const showArchived = ref(false);
const contextMenuId = ref<string | null>(null);

onMounted(() => {
  postMessage({ type: 'listSessions' });
});

onMessage((msg) => {
  if (msg.type === 'sessionsList') {
    sessions.value = msg.sessions || [];
  } else if (msg.type === 'archivedSessionsList') {
    archivedSessions.value = msg.sessions || [];
  }
});

function loadSession(id: string) {
  emit('load-session', id);
}

function archiveSession(id: string) {
  postMessage({ type: 'archiveSession', id });
  contextMenuId.value = null;
}

function deleteSession(id: string) {
  postMessage({ type: 'deleteSession', id });
  contextMenuId.value = null;
}

function unarchiveSession(id: string) {
  postMessage({ type: 'unarchiveSession', id });
}

function toggleArchived() {
  showArchived.value = !showArchived.value;
  if (showArchived.value) {
    postMessage({ type: 'listArchivedSessions' });
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function toggleContextMenu(id: string, event: MouseEvent) {
  event.stopPropagation();
  contextMenuId.value = contextMenuId.value === id ? null : id;
}
</script>

<template>
  <div class="flex flex-col border-b border-vscode-border bg-vscode-bg max-h-[50vh] overflow-hidden shrink-0">
    <div class="flex items-center justify-between px-3 py-1.5 border-b border-vscode-border">
      <span class="text-[11px] font-medium text-vscode-foreground">Session History</span>
      <div class="flex items-center gap-1">
        <button
          class="text-[10px] px-1.5 py-0.5 rounded hover:bg-vscode-hover text-vscode-muted"
          @click="toggleArchived"
        >
          {{ showArchived ? 'Active' : 'Archived' }}
        </button>
        <button
          class="p-0.5 rounded hover:bg-vscode-hover text-vscode-muted hover:text-vscode-foreground"
          title="Close"
          @click="$emit('close')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Active sessions -->
      <template v-if="!showArchived">
        <div v-if="sessions.length === 0" class="px-3 py-4 text-center text-[11px] text-vscode-muted">
          No sessions yet
        </div>
        <div
          v-for="session in sessions"
          :key="session.id"
          class="relative flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-vscode-hover border-b border-vscode-border/50 group"
          @click="loadSession(session.id)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-vscode-foreground truncate">{{ session.title }}</span>
              <span
                v-if="session.mode"
                class="text-[9px] px-1 py-0 rounded bg-vscode-hover text-vscode-muted shrink-0"
              >{{ session.mode }}</span>
            </div>
            <div class="text-[10px] text-vscode-muted">{{ formatDate(session.updatedAt) }}</div>
          </div>
          <button
            class="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-vscode-hover text-vscode-muted"
            title="More actions"
            @click="toggleContextMenu(session.id, $event)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM9.5 13a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0z"/>
            </svg>
          </button>
          <!-- Context menu -->
          <div
            v-if="contextMenuId === session.id"
            class="absolute right-2 top-full z-10 bg-vscode-dropdown border border-vscode-border rounded shadow-lg py-0.5 min-w-[100px]"
          >
            <button
              class="w-full text-left px-3 py-1 text-[11px] text-vscode-foreground hover:bg-vscode-hover"
              @click="archiveSession(session.id)"
            >Archive</button>
            <button
              class="w-full text-left px-3 py-1 text-[11px] text-red-400 hover:bg-vscode-hover"
              @click="deleteSession(session.id)"
            >Delete</button>
          </div>
        </div>
      </template>

      <!-- Archived sessions -->
      <template v-else>
        <div v-if="archivedSessions.length === 0" class="px-3 py-4 text-center text-[11px] text-vscode-muted">
          No archived sessions
        </div>
        <div
          v-for="session in archivedSessions"
          :key="session.id"
          class="flex items-center gap-2 px-3 py-2 border-b border-vscode-border/50 group"
        >
          <div class="flex-1 min-w-0">
            <div class="text-[11px] text-vscode-foreground truncate">{{ session.title }}</div>
            <div class="text-[10px] text-vscode-muted">{{ formatDate(session.updatedAt) }}</div>
          </div>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-vscode-hover text-vscode-muted"
            @click="unarchiveSession(session.id)"
          >Restore</button>
        </div>
      </template>
    </div>
  </div>
</template>
