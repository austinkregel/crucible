import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatMode = 'ask' | 'plan' | 'agent';
export type AgentPhase = 'planning' | 'validation' | 'execution' | 'postValidation';
export type ToolStatus = 'running' | 'completed' | 'failed';

export interface PlanArtifact {
  summary: string;
  steps: PlanStepArtifact[];
  assumptions: string[];
  approved: boolean;
  confidenceScore?: number;
}

export interface PlanStepArtifact {
  id: string;
  goal: string;
  files: string[];
  risks: string[];
  constraints: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  model?: string;
  provider?: string;
  tokenEstimate?: number;
  costEstimate?: number;
  contextFiles?: string[];
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: string;
  toolStatus?: ToolStatus;
  duration_ms?: number;
  collapsed?: boolean;
  phase?: AgentPhase;
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const mode = ref<ChatMode>('ask');
  const selectedProvider = ref('ollama');
  const selectedModel = ref('qwen3:27b');
  const isStreaming = ref(false);
  const streamingContent = ref('');
  const currentRequestId = ref<string | null>(null);
  const activePlan = ref<PlanArtifact | null>(null);

  const messageCount = computed(() => messages.value.length);
  const hasPlan = computed(() => activePlan.value !== null);
  const isPlanApproved = computed(() => activePlan.value?.approved === true);

  function addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>) {
    messages.value.push({
      ...message,
      id: generateId(),
      timestamp: Date.now(),
      collapsed: message.collapsed ?? (message.role === 'tool'),
    });
  }

  function updateLastAssistant(content: string) {
    const last = messages.value[messages.value.length - 1];
    if (last && last.role === 'assistant') {
      last.content = content;
    }
  }

  function updateToolMessage(id: string, updates: Partial<Pick<ChatMessage, 'toolResult' | 'toolStatus' | 'content' | 'collapsed' | 'duration_ms'>>) {
    const msg = messages.value.find((m) => m.id === id);
    if (!msg) return;
    if (updates.toolResult !== undefined) msg.toolResult = updates.toolResult;
    if (updates.toolStatus !== undefined) msg.toolStatus = updates.toolStatus;
    if (updates.content !== undefined) msg.content = updates.content;
    if (updates.collapsed !== undefined) msg.collapsed = updates.collapsed;
    if (updates.duration_ms !== undefined) msg.duration_ms = updates.duration_ms;
  }

  function clearMessages() {
    messages.value = [];
  }

  function setMode(newMode: ChatMode) {
    mode.value = newMode;
  }

  function setProvider(provider: string, model?: string) {
    selectedProvider.value = provider;
    if (model) {
      selectedModel.value = model;
    }
  }

  function setPlan(plan: PlanArtifact) {
    activePlan.value = plan;
  }

  function approvePlan() {
    if (activePlan.value) {
      activePlan.value.approved = true;
    }
  }

  function clearPlan() {
    activePlan.value = null;
  }

  function updatePlanStep(stepId: string, status: PlanStepArtifact['status'], result?: string) {
    if (!activePlan.value) return;
    const step = activePlan.value.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = status;
      if (result !== undefined) step.result = result;
    }
  }

  function startStream(requestId: string) {
    currentRequestId.value = requestId;
    isStreaming.value = true;
    streamingContent.value = '';
    addMessage({
      role: 'assistant',
      content: '',
      provider: selectedProvider.value,
      model: selectedModel.value,
    });
  }

  function appendStreamToken(requestId: string, token: string) {
    if (requestId !== currentRequestId.value) return;
    streamingContent.value += token;
    updateLastAssistant(streamingContent.value);
  }

  function endStream(requestId: string) {
    if (requestId !== currentRequestId.value) return;
    isStreaming.value = false;
    streamingContent.value = '';
    currentRequestId.value = null;
  }

  function handleStreamError(requestId: string, error: string) {
    if (requestId !== currentRequestId.value) return;
    isStreaming.value = false;
    streamingContent.value = '';
    currentRequestId.value = null;
    addMessage({
      role: 'system',
      content: `Error: ${error}`,
    });
  }

  return {
    messages,
    mode,
    selectedProvider,
    selectedModel,
    isStreaming,
    streamingContent,
    messageCount,
    activePlan,
    hasPlan,
    isPlanApproved,
    addMessage,
    updateToolMessage,
    clearMessages,
    setMode,
    setProvider,
    setPlan,
    approvePlan,
    clearPlan,
    updatePlanStep,
    startStream,
    appendStreamToken,
    endStream,
    handleStreamError,
  };
});

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
