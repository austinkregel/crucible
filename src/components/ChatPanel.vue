<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from 'vue';
import { useChatStore, type AgentPhase } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { useVSCode } from '../composables/useVSCode';
import MessageBubble from './MessageBubble.vue';
import InputBar from './InputBar.vue';
import CostIndicator from './CostIndicator.vue';
import PlanViewer from './PlanViewer.vue';
import ValidationFeedback from './ValidationFeedback.vue';
import PhaseIndicator from './PhaseIndicator.vue';
import ActivityLog from './ActivityLog.vue';
import SessionHistory from './SessionHistory.vue';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { postMessage, onMessage } = useVSCode();
const messagesContainer = ref<HTMLElement | null>(null);
const contextFiles = ref<string[]>([]);

const agentPlan = ref<any>(null);
const agentValidation = ref<any>(null);
const agentRunning = ref(false);
const agentPhase = ref<AgentPhase | null>(null);

// Track pending tool call message IDs so we can update them when completed/failed
const pendingToolCalls = ref<Map<string, string>>(new Map());

// Activity log: full transparent record of agent actions
interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'tool_call' | 'tool_result' | 'thinking' | 'phase' | 'error';
  tool?: string;
  args?: Record<string, any>;
  result?: string;
  status?: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  content?: string;
}

const activityLog = ref<ActivityEntry[]>([]);
const executorThinking = ref<string>('');
const showSessionHistory = ref(false);

// Ollama diagnostics state
interface OllamaDiagnostic {
  error: string;
  errorKind?: string;
  suggestion?: string;
  model?: string;
}
const ollamaDiagnostic = ref<OllamaDiagnostic | null>(null);

interface ProviderStatus {
  providerId: string;
  connected: boolean;
  installedModels: string[];
  runningModels: Array<{ name: string; size: number; sizeVram: number }>;
  configuredRoles: Array<{ role: string; model: string; installed: boolean; running: boolean }>;
}
const providerStatus = ref<ProviderStatus | null>(null);

onMounted(() => {
  postMessage({ type: 'getProviders' });
  postMessage({ type: 'getConfig' });
  postMessage({ type: 'getIndexStatus' });
  postMessage({ type: 'getSession' });
});

onMessage((msg) => {
  switch (msg.type) {
    case 'providers':
      settingsStore.setProviders(msg.providers);
      syncSelectedModel();
      break;
    case 'config':
      settingsStore.setConfig(msg.config);
      break;
    case 'indexStatus':
      settingsStore.setIndexStatus(msg.status);
      break;
    case 'chatStreamStart':
      chatStore.startStream(msg.requestId);
      break;
    case 'chatStreamToken':
      chatStore.appendStreamToken(msg.requestId, msg.token);
      break;
    case 'chatStreamEnd':
      chatStore.endStream(msg.requestId);
      break;
    case 'chatError':
      chatStore.handleStreamError(msg.requestId, msg.error);
      if (msg.errorKind) {
        ollamaDiagnostic.value = {
          error: msg.error,
          errorKind: msg.errorKind,
          suggestion: msg.suggestion,
          model: msg.model,
        };
        postMessage({ type: 'getProviderStatus', providerId: 'ollama' });
      }
      break;
    case 'providerStatus':
      providerStatus.value = msg.diagnostics;
      break;
    case 'filesSelected':
      if (msg.paths?.length) {
        contextFiles.value.push(...msg.paths);
      }
      break;
    case 'newSession':
      chatStore.clearMessages();
      chatStore.clearPlan();
      agentPlan.value = null;
      agentValidation.value = null;
      agentPhase.value = null;
      contextFiles.value = [];
      pendingToolCalls.value.clear();
      activityLog.value = [];
      executorThinking.value = '';
      break;
    case 'sessionMessages':
      hydrateFromStoredMessages(msg.messages || []);
      break;
    case 'sessionLoaded':
      chatStore.clearMessages();
      chatStore.clearPlan();
      agentPlan.value = null;
      agentValidation.value = null;
      agentPhase.value = null;
      contextFiles.value = [];
      pendingToolCalls.value.clear();
      activityLog.value = [];
      executorThinking.value = '';
      hydrateFromStoredMessages(msg.session?.messages || []);
      break;
    case 'agentStart':
      agentRunning.value = true;
      agentPhase.value = null;
      break;
    case 'agentEvent':
      handleAgentEvent(msg.event);
      break;
    case 'agentEnd':
      agentRunning.value = false;
      agentPhase.value = null;
      // Flush any remaining thinking content
      if (executorThinking.value.trim()) {
        activityLog.value.push({
          id: `thinking-${Date.now()}`,
          timestamp: Date.now(),
          type: 'thinking',
          content: executorThinking.value,
        });
        executorThinking.value = '';
      }
      break;
  }
});

function handleAgentEvent(event: any) {
  switch (event.type) {
    case 'phaseStarted':
      agentPhase.value = event.data.phase;
      break;

    case 'planGenerated':
      agentPlan.value = {
        summary: event.data.plan,
        steps: event.data.steps.map((s: any) => ({
          ...s,
          status: s.status || 'pending',
        })),
        assumptions: event.data.assumptions,
      };
      chatStore.addMessage({
        role: 'assistant',
        content: `**Plan generated:** ${event.data.plan}`,
        model: 'planner',
        phase: 'planning',
      });
      break;

    case 'validationComplete':
      agentValidation.value = {
        issues: event.data.issues,
        missingCases: event.data.missingCases,
        conflicts: event.data.conflicts,
        confidenceScore: event.data.confidenceScore,
        approved: event.data.approved,
      };
      chatStore.addMessage({
        role: 'assistant',
        content: `**Validation:** Confidence ${(event.data.confidenceScore * 100).toFixed(0)}% ${event.data.approved ? '(approved)' : '(needs revision)'}`,
        model: 'validator',
        phase: 'validation',
      });
      break;

    case 'planRefined':
      agentPlan.value = {
        summary: event.data.plan?.plan || agentPlan.value?.summary,
        steps: event.data.plan?.steps || agentPlan.value?.steps,
        assumptions: event.data.plan?.assumptions || agentPlan.value?.assumptions,
      };
      chatStore.addMessage({
        role: 'system',
        content: `Plan refined (iteration ${event.data.iteration})`,
        phase: 'validation',
      });
      break;

    case 'planComplete': {
      const plan = event.data.plan;
      const approved = event.data.approved;
      const confidence = event.data.validation?.confidenceScore;
      chatStore.setPlan({
        summary: plan.plan,
        steps: (plan.steps || []).map((s: any) => ({
          ...s,
          status: s.status || 'pending',
        })),
        assumptions: plan.assumptions || [],
        approved,
        confidenceScore: confidence,
      });
      chatStore.addMessage({
        role: 'assistant',
        content: approved
          ? `**Plan ready** (confidence: ${((confidence ?? 0) * 100).toFixed(0)}%). Switch to Agent mode and click "Execute Plan" to implement it.`
          : `**Plan generated** but did not reach confidence threshold. You can review it and decide whether to proceed.`,
        model: 'planner',
        phase: 'planning',
      });
      break;
    }

    case 'stepStarted':
      chatStore.addMessage({
        role: 'system',
        content: `Executing step: ${event.data.step?.goal || event.data.stepId}`,
        phase: 'execution',
      });
      break;

    case 'stepCompleted':
      if (agentPlan.value) {
        const step = agentPlan.value.steps.find((s: any) => s.id === event.data.stepId);
        if (step) step.status = 'done';
      }
      break;

    case 'stepFailed':
      if (agentPlan.value) {
        const step = agentPlan.value.steps.find((s: any) => s.id === event.data.stepId);
        if (step) step.status = 'failed';
      }
      chatStore.addMessage({
        role: 'system',
        content: `Step failed: ${event.data.error || event.data.stepId}`,
        phase: 'execution',
      });
      break;

    case 'toolCallStarted': {
      const toolKey = `${event.data.tool}:${JSON.stringify(event.data.args)}`;
      chatStore.addMessage({
        role: 'tool',
        content: `${event.data.tool}: ${summarizeArgs(event.data.args)}`,
        toolName: event.data.tool,
        toolArgs: event.data.args,
        toolStatus: 'running',
        phase: 'execution',
      });
      const lastMsg = chatStore.messages[chatStore.messages.length - 1];
      pendingToolCalls.value.set(toolKey, lastMsg.id);

      // Flush any accumulated thinking before the tool call entry
      if (executorThinking.value.trim()) {
        activityLog.value.push({
          id: `thinking-${Date.now()}`,
          timestamp: Date.now(),
          type: 'thinking',
          content: executorThinking.value,
        });
        executorThinking.value = '';
      }

      activityLog.value.push({
        id: `tool-${Date.now()}-${event.data.tool}`,
        timestamp: Date.now(),
        type: 'tool_call',
        tool: event.data.tool,
        args: event.data.args,
        status: 'running',
      });
      break;
    }

    case 'toolCallCompleted': {
      const toolKey = `${event.data.tool}:${JSON.stringify(event.data.args)}`;
      const msgId = pendingToolCalls.value.get(toolKey);
      if (msgId) {
        chatStore.updateToolMessage(msgId, {
          toolResult: event.data.result?.output || '',
          toolStatus: 'completed',
          duration_ms: event.data.duration_ms,
        });
        pendingToolCalls.value.delete(toolKey);
      }

      const logEntry = [...activityLog.value].reverse().find(
        (e) => e.type === 'tool_call' && e.tool === event.data.tool && e.status === 'running',
      );
      if (logEntry) {
        logEntry.status = 'completed';
        logEntry.result = event.data.result?.output || '';
        logEntry.duration_ms = event.data.duration_ms;
      }
      break;
    }

    case 'toolCallFailed': {
      const toolKey = `${event.data.tool}:${JSON.stringify(event.data.args)}`;
      const msgId = pendingToolCalls.value.get(toolKey);
      if (msgId) {
        chatStore.updateToolMessage(msgId, {
          toolResult: undefined,
          toolStatus: 'failed',
          content: event.data.error || 'Tool call failed',
          duration_ms: event.data.duration_ms,
        });
        pendingToolCalls.value.delete(toolKey);
      }

      const logEntry = [...activityLog.value].reverse().find(
        (e) => e.type === 'tool_call' && e.tool === event.data.tool && e.status === 'running',
      );
      if (logEntry) {
        logEntry.status = 'failed';
        logEntry.result = event.data.error || 'Tool call failed';
        logEntry.duration_ms = event.data.duration_ms;
      }
      break;
    }

    case 'streamToken':
      executorThinking.value += event.data.token;
      break;

    case 'postValidationComplete':
      chatStore.addMessage({
        role: 'assistant',
        content: event.data.approved
          ? '**Post-validation:** Implementation approved.'
          : `**Post-validation:** Issues found: ${event.data.issues.join(', ')}`,
        model: 'post-validator',
        phase: 'postValidation',
      });
      break;

    case 'error':
      chatStore.addMessage({
        role: 'system',
        content: `Error: ${event.data.message}`,
      });
      if (event.data.errorKind) {
        ollamaDiagnostic.value = {
          error: event.data.message,
          errorKind: event.data.errorKind,
          suggestion: event.data.suggestion,
          model: event.data.model,
        };
        postMessage({ type: 'getProviderStatus', providerId: 'ollama' });
      }
      break;

    case 'complete':
      chatStore.addMessage({
        role: 'assistant',
        content: 'Agent task completed.',
      });
      break;
  }
}

function summarizeArgs(args: Record<string, any>): string {
  if (args.path) return args.path;
  if (args.pattern) return `"${args.pattern}"`;
  if (args.command) return `$ ${args.command}`;
  if (args.query) return args.query;
  return Object.values(args).join(', ');
}

function hydrateFromStoredMessages(messages: any[]): void {
  if (!messages || messages.length === 0) return;
  for (const msg of messages) {
    if (msg.role === 'tool') {
      chatStore.addMessage({
        role: 'tool',
        content: msg.content,
        toolName: msg.toolName,
        toolArgs: msg.toolArgs,
        toolStatus: msg.toolStatus || 'completed',
      });
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      chatStore.addMessage({
        role: msg.role,
        content: msg.content,
      });
    }
  }
}

watch(
  () => chatStore.messages.length,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

watch(
  () => chatStore.streamingContent,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function handleSend(text: string) {
  const isBusy = chatStore.isStreaming || agentRunning.value;
  if (!text.trim() || isBusy) return;

  const attachedFiles = [...contextFiles.value];
  chatStore.addMessage({
    role: 'user',
    content: text,
    contextFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
  });
  contextFiles.value = [];

  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  switch (chatStore.mode) {
    case 'plan':
      postMessage({
        type: 'planChat',
        query: text,
        contextFiles: attachedFiles,
        requestId,
      });
      break;
    case 'agent':
      postMessage({
        type: 'agentChat',
        query: text,
        contextFiles: attachedFiles,
        requestId,
      });
      break;
    case 'ask':
    default: {
      const messagesToSend = chatStore.messages
        .filter((m) => m.role !== 'system' && m.role !== 'tool')
        .map((m) => ({ role: m.role, content: m.content }));

      postMessage({
        type: 'chat',
        messages: messagesToSend,
        contextFiles: attachedFiles,
        providerId: chatStore.selectedProvider,
        model: chatStore.selectedModel,
        requestId,
      });
      break;
    }
  }
}

function handleFilesAdded(files: string[]) {
  contextFiles.value.push(...files);
  postMessage({ type: 'addContextFiles', paths: files });
}

function removeContextFile(index: number) {
  contextFiles.value.splice(index, 1);
}

const currentModels = computed(() => {
  const provider = settingsStore.providers.find((p) => p.id === chatStore.selectedProvider);
  if (provider) return provider.models;
  const defaults: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini'],
    anthropic: ['claude-sonnet-4-5-20250514', 'claude-haiku-3-5-20241022'],
    ollama: ['qwen3:27b', 'qwen3:8b', 'llama3:8b'],
  };
  return defaults[chatStore.selectedProvider] || [];
});

function syncSelectedModel() {
  const models = currentModels.value;
  if (models.length > 0 && !models.includes(chatStore.selectedModel)) {
    chatStore.setProvider(chatStore.selectedProvider, models[0]);
  }
}

function handleProviderChange(newProviderId: string) {
  chatStore.setProvider(newProviderId);
  syncSelectedModel();
}

function executePlan() {
  if (!chatStore.activePlan) return;
  chatStore.approvePlan();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  postMessage({
    type: 'executePlan',
    plan: {
      plan: chatStore.activePlan.summary,
      steps: chatStore.activePlan.steps,
      assumptions: chatStore.activePlan.assumptions,
    },
    requestId,
  });
}

function discardPlan() {
  chatStore.clearPlan();
  agentPlan.value = null;
  agentValidation.value = null;
}

function startNewSession() {
  postMessage({ type: 'newSession' });
  chatStore.clearMessages();
  chatStore.clearPlan();
  agentPlan.value = null;
  agentValidation.value = null;
  agentPhase.value = null;
  contextFiles.value = [];
  pendingToolCalls.value.clear();
  activityLog.value = [];
  executorThinking.value = '';
}

function handleLoadSession(sessionId: string) {
  postMessage({ type: 'loadSession', id: sessionId });
  showSessionHistory.value = false;
}

function handleStop() {
  postMessage({ type: 'cancelRequest' });
}

const modeHints: Record<string, string> = {
  ask: 'Ask a question about your codebase (read-only)',
  plan: 'Describe a feature to plan with multi-agent adversarial review',
  agent: 'Describe a task for the full agent pipeline to execute',
};

defineExpose({ showSessionHistory, startNewSession });
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Session history panel (overlay) -->
    <SessionHistory
      v-if="showSessionHistory"
      @close="showSessionHistory = false"
      @load-session="handleLoadSession"
    />

    <!-- Index status bar -->
    <div
      v-if="settingsStore.indexStatus.state === 'scanning'"
      class="flex items-center gap-2 px-3 py-1 border-b border-vscode-border text-[10px] text-vscode-muted shrink-0"
    >
      <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      <span>Scanning files...</span>
    </div>
    <div
      v-else-if="settingsStore.indexStatus.state === 'hashing'"
      class="flex items-center gap-2 px-3 py-1 border-b border-vscode-border text-[10px] text-vscode-muted shrink-0"
    >
      <div class="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      <span>
        Checking files... {{ settingsStore.indexStatus.processedFiles }}/{{ settingsStore.indexStatus.totalFiles }}
      </span>
    </div>
    <div
      v-else-if="settingsStore.indexStatus.state === 'indexing'"
      class="flex items-center gap-2 px-3 py-1 border-b border-vscode-border text-[10px] text-vscode-muted shrink-0"
    >
      <div class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
      <span>
        Indexing... {{ settingsStore.indexStatus.processedFiles }}/{{ settingsStore.indexStatus.totalFiles }} files
        <template v-if="settingsStore.indexStatus.changedFiles">
          ({{ settingsStore.indexStatus.changedFiles }} changed, {{ settingsStore.indexStatus.totalChunks }} chunks)
        </template>
        <template v-else>
          ({{ settingsStore.indexStatus.totalChunks }} chunks)
        </template>
      </span>
    </div>
    <div
      v-else-if="settingsStore.indexStatus.state === 'ready'"
      class="flex items-center gap-2 px-3 py-0.5 border-b border-vscode-border text-[10px] text-vscode-muted shrink-0"
    >
      <div class="w-1.5 h-1.5 rounded-full bg-green-500" />
      <span>{{ settingsStore.indexStatus.totalChunks }} chunks indexed</span>
    </div>

    <!-- Agent phase indicator -->
    <PhaseIndicator
      v-if="agentRunning && agentPhase"
      :current-phase="agentPhase"
      class="border-b border-vscode-border shrink-0"
    />

    <!-- Messages -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      <div v-if="chatStore.messages.length === 0" class="flex items-center justify-center h-full">
        <div class="text-center text-vscode-muted">
          <p class="text-sm mb-1">Welcome to Crucible</p>
          <p class="text-xs">{{ modeHints[chatStore.mode] || 'Start a conversation' }}</p>
        </div>
      </div>
      <MessageBubble
        v-for="msg in chatStore.messages"
        :key="msg.id"
        :message="msg"
      />

      <PlanViewer
        v-if="agentPlan"
        :plan="agentPlan"
        @approve-step="() => {}"
        @reject-step="() => {}"
      />
      <ValidationFeedback
        v-if="agentValidation"
        :validation="agentValidation"
      />

      <!-- Ollama Diagnostics Panel -->
      <div
        v-if="ollamaDiagnostic"
        class="mx-1 my-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-[11px]"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1">
            <div class="font-semibold text-red-400 mb-1">{{ ollamaDiagnostic.error }}</div>
            <div v-if="ollamaDiagnostic.suggestion" class="text-vscode-muted mb-2">
              {{ ollamaDiagnostic.suggestion }}
            </div>

            <div v-if="providerStatus" class="space-y-1 mt-2 text-[10px]">
              <div class="flex items-center gap-1">
                <span :class="providerStatus.connected ? 'text-green-400' : 'text-red-400'">
                  {{ providerStatus.connected ? '●' : '○' }}
                </span>
                <span>Ollama {{ providerStatus.connected ? 'connected' : 'not reachable' }}</span>
              </div>
              <div v-if="providerStatus.runningModels.length > 0">
                <span class="text-vscode-muted">Running:</span>
                <span v-for="m in providerStatus.runningModels" :key="m.name" class="ml-1 font-mono">
                  {{ m.name }} ({{ (m.sizeVram / 1e9).toFixed(1) }}GB VRAM)
                </span>
              </div>
              <div v-else class="text-vscode-muted">No models currently loaded in memory.</div>
              <div v-if="providerStatus.configuredRoles.length > 0" class="mt-1">
                <div v-for="r in providerStatus.configuredRoles" :key="r.role" class="flex items-center gap-1">
                  <span :class="r.installed ? (r.running ? 'text-green-400' : 'text-yellow-400') : 'text-red-400'">
                    {{ r.installed ? (r.running ? '●' : '◐') : '○' }}
                  </span>
                  <span class="font-mono">{{ r.role }}: {{ r.model }}</span>
                  <span v-if="!r.installed" class="text-red-400">(not installed)</span>
                  <span v-else-if="!r.running" class="text-yellow-400">(not loaded)</span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-1 shrink-0">
            <button
              v-if="ollamaDiagnostic.errorKind === 'model_not_found' && ollamaDiagnostic.model"
              class="px-2 py-1 text-[10px] font-medium rounded bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover"
              @click="postMessage({ type: 'pullModel', providerId: 'ollama', modelName: ollamaDiagnostic.model }); ollamaDiagnostic = null"
            >
              Pull Model
            </button>
            <button
              class="px-2 py-1 text-[10px] text-vscode-muted hover:text-vscode-fg"
              @click="ollamaDiagnostic = null; providerStatus = null"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>

      <!-- Activity Log: full transparent audit trail of agent actions -->
      <ActivityLog
        v-if="activityLog.length > 0 || executorThinking"
        :entries="activityLog"
        :streaming-thinking="executorThinking"
      />

      <!-- Plan action bar: shown when a plan exists and hasn't been executed yet -->
      <div
        v-if="chatStore.activePlan && !chatStore.isPlanApproved && !agentRunning"
        class="flex items-center gap-2 px-3 py-2 mx-1 rounded-lg border border-vscode-border bg-vscode-input-bg"
      >
        <div class="flex-1 text-[11px] text-vscode-muted">
          Plan ready ({{ chatStore.activePlan.steps.length }} steps).
          Switch to Agent mode to execute.
        </div>
        <button
          v-if="chatStore.mode === 'agent'"
          class="px-3 py-1 text-[11px] font-medium rounded bg-vscode-button-bg text-vscode-button-fg hover:bg-vscode-button-hover transition-colors"
          @click="executePlan"
        >
          Execute Plan
        </button>
        <button
          class="px-2 py-1 text-[11px] text-vscode-muted hover:text-vscode-fg transition-colors"
          @click="discardPlan"
        >
          Discard
        </button>
      </div>
    </div>

    <!-- Cost + Input pinned to bottom -->
    <CostIndicator />
    <InputBar
      :disabled="chatStore.isStreaming || agentRunning"
      :show-stop="chatStore.isStreaming || agentRunning"
      :context-files="contextFiles"
      :current-models="currentModels"
      @send="handleSend"
      @stop="handleStop"
      @provider-change="handleProviderChange"
      @files-added="handleFilesAdded"
      @remove-file="removeContextFile"
    />
  </div>
</template>