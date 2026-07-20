import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { ProviderRegistry } from './providers/registry';
import { CacheStore } from './cache/store';
import { CacheWatcher } from './cache/watcher';
import { RollingMemory } from './cache/rollingMemory';
import { ToolRunner } from './tools/runner';
import { PermissionsManager } from './permissions';
import { getPolicyForMode } from './tools/policies';
import { Orchestrator } from './orchestrator/index';
import { SessionManager } from './session/manager';
import { IndexManager } from './indexer/indexManager';
import { Retriever, getRecentFiles } from './retrieval/retriever';
import { BudgetCompiler } from './retrieval/budgetCompiler';
import { ContextCollector } from './context/collector';
import { ProjectGrounding } from './context/projectGrounding';
import { composeSystemPrefix } from './context/systemPrompt';
import { parseMentions, stripMentions } from './context/mentions';
import { PlanStore } from './plans/store';
import { AuditLogger } from './audit/logger';
import { AgentRegistry } from './agent/registry';
import { SubAgentRunner } from './agent/runner';
import { TaskTool } from './tools/taskTool';
import {
  pruneToolOutputs,
  shouldAutoCompact,
  runCompaction,
  rebuildMessagesAfterCompaction,
} from './session/compaction';
import { estimateTokens } from './utils/tokens';
import type { ChatMessage } from './providers/types';

const registry = new ProviderRegistry();
let registryInitialized = false;
let cacheStore: CacheStore;
let cacheWatcher: CacheWatcher;
let orchestrator: Orchestrator;
let sessionManager: SessionManager;
let toolRunner: ToolRunner;
let indexManager: IndexManager;
let retriever: Retriever;
let budgetCompiler: BudgetCompiler;
let collector: ContextCollector;
let rollingMemory: RollingMemory;
let grounding: ProjectGrounding;
let planStore: PlanStore;
let auditLogger: AuditLogger;
let agentRegistry: AgentRegistry;
let subAgentRunner: SubAgentRunner;
let currentView: vscode.WebviewView | null = null;
let activeAbortController: AbortController | null = null;
let compactionSummary: string | undefined;

async function ensureInitialized(context: vscode.ExtensionContext) {
  if (registryInitialized) return;

  await registry.initialize(context);
  cacheStore = CacheStore.fromWorkspace();
  cacheWatcher = new CacheWatcher(cacheStore);
  toolRunner = new ToolRunner();
  toolRunner.registerBuiltins(new PermissionsManager());
  auditLogger = new AuditLogger(randomUUID());
  toolRunner.setAuditLogger(auditLogger);

  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';

  // Build project grounding once so every role/chat is anchored to the real
  // project. Cheap on cache hit (stat-only); never fatal if a source is missing.
  grounding = new ProjectGrounding(cacheStore, wsRoot);
  try {
    await grounding.load();
  } catch (err: any) {
    console.warn('[Crucible] Project grounding failed to load:', err?.message);
  }

  agentRegistry = new AgentRegistry(wsRoot);
  subAgentRunner = new SubAgentRunner(agentRegistry, toolRunner);
  subAgentRunner.setAuditLogger(auditLogger);

  const taskTool = new TaskTool(subAgentRunner, agentRegistry, () => {
    const roleConfig = registry.getByRole('executor');
    if (!roleConfig) return undefined;
    return { provider: roleConfig.provider, model: roleConfig.model };
  });
  toolRunner.register(taskTool);

  orchestrator = new Orchestrator(registry, cacheStore, toolRunner, grounding);
  orchestrator.setAuditLogger(auditLogger);
  sessionManager = new SessionManager();

  const config = vscode.workspace.getConfiguration('crucible');
  const autoArchiveDays = config.get<number>('sessions.autoArchiveDays', 7);
  const archived = sessionManager.archiveStale(autoArchiveDays);
  if (archived > 0) {
    console.log(`[Crucible] Auto-archived ${archived} stale session(s) older than ${autoArchiveDays} days.`);
  }

  collector = new ContextCollector(cacheStore);
  rollingMemory = new RollingMemory(cacheStore);
  budgetCompiler = new BudgetCompiler();
  planStore = new PlanStore();
  context.subscriptions.push(cacheWatcher);

  registryInitialized = true;

  // Initialize indexer lazily in background -- never block or crash the extension host
  initIndexer(context).catch((err) => {
    console.warn('[Crucible] Indexer init failed, continuing without indexing:', err?.message);
  });
}

let indexerInitialized = false;

async function initIndexer(context: vscode.ExtensionContext) {
  if (indexerInitialized) return;
  indexerInitialized = true;

  const config = vscode.workspace.getConfiguration('crucible');
  const indexingEnabled = config.get<boolean>('indexing.enabled', true);
  if (!indexingEnabled) return;

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const ollamaBaseUrl = config.get<string>('providers.ollama.baseUrl', 'http://localhost:11434');

  try {
    indexManager = new IndexManager(workspacePath, ollamaBaseUrl);
    retriever = new Retriever(indexManager.getEmbedder(), indexManager.getVectorStore());

    indexManager.onStatusChange((status) => {
      currentView?.webview.postMessage({ type: 'indexStatus', status });
      console.log(`[Crucible] Index status: ${status.state} ${status.processedFiles}/${status.totalFiles} (${status.changedFiles ?? 0} changed, ${status.totalChunks} chunks)${status.error ? ' ERROR: ' + status.error : ''}`);
    });

    indexManager.registerWatchers(workspacePath);
    context.subscriptions.push(indexManager);

    await indexManager.indexWorkspace(workspacePath);
  } catch (err: any) {
    console.warn('[Crucible] Indexing error:', err?.message);
    // Extension continues to work without indexing
  }
}

export async function handleWebviewMessage(
  message: any,
  context: vscode.ExtensionContext,
  view: vscode.WebviewView,
) {
  currentView = view;
  await ensureInitialized(context);

  switch (message.type) {
    case 'cancelRequest': {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      view.webview.postMessage({ type: 'chatStreamEnd', requestId: message.requestId || '' });
      view.webview.postMessage({ type: 'agentEnd', requestId: message.requestId || '' });
      break;
    }
    case 'chat': {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      toolRunner.setPolicy(getPolicyForMode('ask', wsRoot));
      await handleQuickChat(message, view);
      break;
    }
    case 'planChat': {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      toolRunner.setPolicy(getPolicyForMode('plan', wsRoot));
      await handlePlanChat(message, view);
      break;
    }
    case 'executePlan': {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      toolRunner.setPolicy(getPolicyForMode('agent', wsRoot));
      await handleExecutePlan(message, view);
      break;
    }
    case 'agentChat': {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      toolRunner.setPolicy(getPolicyForMode('agent', wsRoot));
      await handleAgentChat(message, view);
      break;
    }
    case 'getProviders': {
      const providers = registry.list().map((p) => ({
        id: p.id,
        name: p.name,
        models: p.models,
        connected: (p as any).connected ?? true,
      }));
      view.webview.postMessage({ type: 'providers', providers });
      break;
    }
    case 'getConfig': {
      const config = vscode.workspace.getConfiguration('crucible');
      view.webview.postMessage({
        type: 'config',
        config: {
          roles: {
            planner: config.get('roles.planner'),
            executor: config.get('roles.executor'),
            validator: config.get('roles.validator'),
            postValidator: config.get('roles.postValidator'),
          },
          adversarial: {
            confidenceThreshold: config.get('adversarial.confidenceThreshold'),
            maxIterations: config.get('adversarial.maxIterations'),
            postValidation: config.get('adversarial.postValidation'),
          },
        },
      });
      break;
    }
    case 'updateConfig': {
      const cfg = vscode.workspace.getConfiguration('crucible');
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      if (message.roles) {
        for (const [role, value] of Object.entries(message.roles)) {
          await cfg.update(`roles.${role}`, value, target);
        }
      }
      if (message.adversarial) {
        for (const [key, value] of Object.entries(message.adversarial)) {
          await cfg.update(`adversarial.${key}`, value, target);
        }
      }
      const updated = vscode.workspace.getConfiguration('crucible');
      view.webview.postMessage({
        type: 'config',
        config: {
          roles: {
            planner: updated.get('roles.planner'),
            executor: updated.get('roles.executor'),
            validator: updated.get('roles.validator'),
            postValidator: updated.get('roles.postValidator'),
          },
          adversarial: {
            confidenceThreshold: updated.get('adversarial.confidenceThreshold'),
            maxIterations: updated.get('adversarial.maxIterations'),
            postValidation: updated.get('adversarial.postValidation'),
          },
        },
      });
      break;
    }
    case 'getIndexStatus': {
      if (indexManager) {
        view.webview.postMessage({
          type: 'indexStatus',
          status: indexManager.getStatus(),
        });
      }
      break;
    }
    case 'reindexAll': {
      const folders = vscode.workspace.workspaceFolders;
      if (indexManager && folders) {
        indexManager.reindexAll(folders[0].uri.fsPath).catch(() => {});
      }
      break;
    }
    case 'addContextFiles': {
      break;
    }
    case 'browseFiles': {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: 'Add to context',
      });
      if (uris && uris.length > 0) {
        const paths = uris.map((u) => vscode.workspace.asRelativePath(u));
        view.webview.postMessage({ type: 'filesSelected', paths });
      }
      break;
    }
    case 'openFile': {
      if (message.path) {
        const uris = await vscode.workspace.findFiles(message.path, undefined, 1);
        if (uris.length > 0) {
          await vscode.window.showTextDocument(uris[0]);
        }
      }
      break;
    }
    case 'setApiKey': {
      vscode.commands.executeCommand('crucible.setApiKey');
      break;
    }
    case 'clearCache': {
      cacheStore.clearAll();
      vscode.window.showInformationMessage('Crucible: Cache cleared.');
      break;
    }
    case 'listPlans': {
      const plans = planStore.list();
      view.webview.postMessage({ type: 'plansList', plans });
      break;
    }
    case 'loadPlan': {
      const loaded = planStore.load(message.filePath);
      if (loaded) {
        view.webview.postMessage({ type: 'planLoaded', plan: loaded.plan, meta: loaded.meta });
      } else {
        view.webview.postMessage({ type: 'chatError', requestId: '', error: 'Could not load plan.' });
      }
      break;
    }
    case 'deletePlan': {
      planStore.delete(message.filePath);
      const plans = planStore.list();
      view.webview.postMessage({ type: 'plansList', plans });
      break;
    }
    case 'savePlan': {
      const projectName = getProjectName();
      const savedMeta = planStore.save(message.plan, projectName, {
        approved: message.approved,
        confidenceScore: message.confidenceScore,
      });
      view.webview.postMessage({ type: 'planSaved', meta: savedMeta });
      break;
    }
    case 'refreshModels': {
      await handleRefreshModels(message, view);
      break;
    }
    case 'pullModel': {
      await handlePullModel(message, view);
      break;
    }
    case 'getProviderStatus': {
      const providerId = message.providerId || 'ollama';
      const diagnostics = await registry.diagnose(providerId);
      view.webview.postMessage({ type: 'providerStatus', diagnostics });
      break;
    }
    case 'newSession': {
      sessionManager.newSession();
      auditLogger.log('session_start', { reason: 'user_new_session' });
      break;
    }
    case 'getSession': {
      const messages = sessionManager.getMessages();
      view.webview.postMessage({ type: 'sessionMessages', messages });
      break;
    }
    case 'listSessions': {
      const sessions = sessionManager.listSessions();
      view.webview.postMessage({ type: 'sessionsList', sessions });
      break;
    }
    case 'loadSession': {
      const session = sessionManager.loadSession(message.id);
      if (session) {
        view.webview.postMessage({ type: 'sessionLoaded', session });
      } else {
        view.webview.postMessage({ type: 'chatError', requestId: '', error: `Session "${message.id}" not found.` });
      }
      break;
    }
    case 'archiveSession': {
      sessionManager.archiveSession(message.id);
      const updatedSessions = sessionManager.listSessions();
      view.webview.postMessage({ type: 'sessionsList', sessions: updatedSessions });
      break;
    }
    case 'deleteSession': {
      sessionManager.deleteSession(message.id);
      const remainingSessions = sessionManager.listSessions();
      view.webview.postMessage({ type: 'sessionsList', sessions: remainingSessions });
      break;
    }
    case 'listArchivedSessions': {
      const archived = sessionManager.listArchivedSessions();
      view.webview.postMessage({ type: 'archivedSessionsList', sessions: archived });
      break;
    }
    case 'unarchiveSession': {
      sessionManager.unarchiveSession(message.id);
      const archivedRemaining = sessionManager.listArchivedSessions();
      view.webview.postMessage({ type: 'archivedSessionsList', sessions: archivedRemaining });
      break;
    }
    default:
      break;
  }
}

async function handleQuickChat(message: any, view: vscode.WebviewView) {
  const { messages, providerId, model, requestId } = message;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  const provider = registry.get(providerId);
  if (!provider) {
    view.webview.postMessage({
      type: 'chatError',
      requestId,
      error: `Provider "${providerId}" not found. Set an API key via "Crucible: Set API Key".`,
    });
    return;
  }

  try {
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    auditLogger.log('user_input', { mode: 'ask', query: lastUserMessage, providerId, model, requestId });

    // Build context-enriched prompt via retriever + budget compiler
    let systemPrefix = '';
    if (retriever && budgetCompiler) {
      const mentions = parseMentions(lastUserMessage);
      const cleanQuery = stripMentions(lastUserMessage);
      const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;

      const retrievedChunks = await retriever.retrieve(cleanQuery, {
        limit: 10,
        activeFilePath,
        mentions,
        recentFiles: getRecentFiles(),
      });

      const collectedContext = await collector.collect(lastUserMessage);

      const budget = budgetCompiler.compile({
        userQuery: cleanQuery,
        retrievedChunks,
        collectedContext,
        rollingMemory,
        grounding,
      });

      systemPrefix = budget.systemPrefix;

      // If we got retrieved context, prepend it as a system message
      if (budget.includedItems.length > 1) {
        const contextSection = budget.includedItems
          .filter((item) => item.label !== 'User Query')
          .map((item) => item.content)
          .join('\n\n');

        if (contextSection.trim()) {
          systemPrefix += '\n\n## Relevant Codebase Context\n' + contextSection;
        }
      }
    } else {
      // Indexing disabled / not ready: still ground chat in the project.
      systemPrefix = composeSystemPrefix({
        grounding: grounding?.toPromptSection(),
        rollingMemory: rollingMemory?.toPromptSection(),
      });
    }

    let chatMessages: ChatMessage[] = [];

    if (systemPrefix) {
      chatMessages.push({ role: 'system', content: systemPrefix });
    }

    chatMessages.push(
      ...messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    );

    // Auto-compact if conversation exceeds model context budget
    if (shouldAutoCompact(chatMessages, model)) {
      try {
        auditLogger.log('compaction_start', { model, messageCount: chatMessages.length });
        const compactionResult = await runCompaction(chatMessages, model, provider, compactionSummary);
        compactionSummary = compactionResult.summary;
        chatMessages = rebuildMessagesAfterCompaction(compactionResult);
        auditLogger.log('compaction_end', { tokensFreed: compactionResult.tokensFreed });

        sessionManager.addMessage({
          role: 'system',
          content: `[Context compacted - ${compactionResult.tokensFreed} tokens freed]`,
          timestamp: Date.now(),
          compacted: true,
        });
      } catch (err: any) {
        console.warn('[Crucible] Auto-compaction failed, continuing with full context:', err?.message);
      }
    }

    // Prune old tool outputs to stay within budget
    chatMessages = pruneToolOutputs(chatMessages);

    view.webview.postMessage({ type: 'chatStreamStart', requestId });

    let fullAssistantReply = '';
    for await (const token of provider.streamChat(chatMessages, { model })) {
      if (signal.aborted) break;
      fullAssistantReply += token;
      view.webview.postMessage({ type: 'chatStreamToken', requestId, token });
    }

    view.webview.postMessage({ type: 'chatStreamEnd', requestId });

    const inputTokens = estimateTokens(chatMessages.map((m) => m.content).join('\n'));
    const outputTokens = estimateTokens(fullAssistantReply);

    sessionManager.addMessage({
      role: 'user',
      content: lastUserMessage,
      timestamp: Date.now(),
    });
    sessionManager.addMessage({
      role: 'assistant',
      content: fullAssistantReply,
      model,
      provider: providerId,
      timestamp: Date.now(),
      tokens: { inputTokens, outputTokens },
    });
  } catch (err: any) {
    const isOllamaError = err?.name === 'OllamaError';
    view.webview.postMessage({
      type: 'chatError',
      requestId,
      error: err.message || 'Unknown error',
      errorKind: isOllamaError ? err.kind : undefined,
      suggestion: isOllamaError ? err.suggestion : undefined,
      model: isOllamaError ? err.model : undefined,
    });
  }
}

async function handleAgentChat(message: any, view: vscode.WebviewView) {
  const { query, contextFiles, requestId } = message;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  auditLogger.log('user_input', { mode: 'agent', query, contextFiles, requestId });
  sessionManager.addMessage({
    role: 'user',
    content: query,
    timestamp: Date.now(),
  });

  view.webview.postMessage({ type: 'agentStart', requestId });

  await orchestrator.runAgent(query, contextFiles || [], (event) => {
    view.webview.postMessage({
      type: 'agentEvent',
      requestId,
      event,
    });

    auditLogger.log('phase_change', { eventType: event.type, data: event.data });
    persistAgentEvent(event);
  }, signal);

  sessionManager.addMessage({
    role: 'assistant',
    content: signal.aborted ? '[Agent task cancelled]' : '[Agent task completed]',
    timestamp: Date.now(),
  });

  view.webview.postMessage({ type: 'agentEnd', requestId });
}

async function handlePlanChat(message: any, view: vscode.WebviewView) {
  const { query, contextFiles, requestId } = message;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  auditLogger.log('user_input', { mode: 'plan', query, contextFiles, requestId });
  sessionManager.addMessage({
    role: 'user',
    content: query,
    timestamp: Date.now(),
  });

  view.webview.postMessage({ type: 'agentStart', requestId });

  await orchestrator.runPlanOnly(query, contextFiles || [], (event) => {
    view.webview.postMessage({
      type: 'agentEvent',
      requestId,
      event,
    });

    auditLogger.log('phase_change', { eventType: event.type, data: event.data });
    persistAgentEvent(event);

    if (event.type === 'planComplete' && event.data.plan) {
      try {
        const projectName = getProjectName();
        const savedMeta = planStore.save(event.data.plan, projectName, {
          approved: event.data.approved,
          confidenceScore: event.data.validation?.confidenceScore,
        });
        view.webview.postMessage({ type: 'planSaved', meta: savedMeta });
      } catch {
        // Non-critical: plan is still in memory even if save fails
      }
    }
  }, signal);

  sessionManager.addMessage({
    role: 'assistant',
    content: signal.aborted ? '[Plan cancelled]' : '[Plan generated]',
    timestamp: Date.now(),
  });

  view.webview.postMessage({ type: 'agentEnd', requestId });
}

async function handleExecutePlan(message: any, view: vscode.WebviewView) {
  const { plan, requestId } = message;
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  if (!plan?.steps) {
    view.webview.postMessage({
      type: 'chatError',
      requestId,
      error: 'No plan to execute. Generate a plan first using Plan mode.',
    });
    return;
  }

  auditLogger.log('user_input', { mode: 'executePlan', requestId, planSteps: plan.steps.length });

  view.webview.postMessage({ type: 'agentStart', requestId });

  await orchestrator.runAgentWithPlan(plan, (event) => {
    view.webview.postMessage({
      type: 'agentEvent',
      requestId,
      event,
    });

    auditLogger.log('phase_change', { eventType: event.type, data: event.data });
    persistAgentEvent(event);
  }, signal);

  sessionManager.addMessage({
    role: 'assistant',
    content: signal.aborted ? '[Plan execution cancelled]' : '[Plan execution completed]',
    timestamp: Date.now(),
  });

  view.webview.postMessage({ type: 'agentEnd', requestId });
}

async function handleRefreshModels(message: any, view: vscode.WebviewView) {
  const { providerId } = message;

  try {
    if (providerId) {
      const models = await registry.refreshProvider(providerId);
      view.webview.postMessage({ type: 'modelsDiscovered', providerId, models });
    } else {
      const allModels = await registry.refreshAllModels();
      const result: Record<string, any[]> = {};
      for (const [id, models] of allModels) {
        result[id] = models;
      }
      view.webview.postMessage({ type: 'allModelsDiscovered', models: result });
    }

    const providers = registry.list().map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models,
      connected: (p as any).connected ?? true,
    }));
    view.webview.postMessage({ type: 'providers', providers });
  } catch (err: any) {
    view.webview.postMessage({
      type: 'modelsError',
      error: err.message || 'Failed to discover models',
    });
  }
}

async function handlePullModel(message: any, view: vscode.WebviewView) {
  const { providerId, modelName } = message;

  view.webview.postMessage({
    type: 'pullStart',
    providerId,
    modelName,
  });

  const success = await registry.pullModel(providerId, modelName, (progress) => {
    view.webview.postMessage({
      type: 'pullProgress',
      providerId,
      modelName,
      progress,
    });
  });

  view.webview.postMessage({
    type: 'pullComplete',
    providerId,
    modelName,
    success,
  });

  if (success) {
    const providers = registry.list().map((p) => ({
      id: p.id,
      name: p.name,
      models: p.models,
      connected: (p as any).connected ?? true,
    }));
    view.webview.postMessage({ type: 'providers', providers });
  }
}

function persistAgentEvent(event: any): void {
  switch (event.type) {
    case 'toolCallStarted':
      sessionManager.addMessage({
        role: 'tool',
        content: `${event.data.tool}: ${event.data.args?.path || event.data.args?.command || ''}`,
        toolName: event.data.tool,
        toolArgs: event.data.args,
        toolStatus: 'running',
        phase: 'execution',
        timestamp: Date.now(),
      });
      break;
    case 'toolCallCompleted':
      sessionManager.addMessage({
        role: 'tool',
        content: event.data.result?.output || '',
        toolName: event.data.tool,
        toolResult: event.data.result?.output || '',
        toolStatus: 'completed',
        phase: 'execution',
        timestamp: Date.now(),
      });
      break;
    case 'toolCallFailed':
      sessionManager.addMessage({
        role: 'tool',
        content: event.data.error || 'Tool call failed',
        toolName: event.data.tool,
        toolStatus: 'failed',
        phase: 'execution',
        timestamp: Date.now(),
      });
      break;
    case 'planGenerated':
      sessionManager.addMessage({
        role: 'assistant',
        content: `Plan: ${event.data.plan || ''}`,
        phase: 'planning',
        timestamp: Date.now(),
      });
      break;
    case 'validationComplete':
      sessionManager.addMessage({
        role: 'assistant',
        content: `Validation: confidence ${((event.data.confidenceScore || 0) * 100).toFixed(0)}%`,
        phase: 'validation',
        timestamp: Date.now(),
      });
      break;
    case 'error':
      sessionManager.addMessage({
        role: 'system',
        content: `Error: ${event.data.message || ''}`,
        timestamp: Date.now(),
      });
      break;
  }
}

function getProjectName(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return 'unknown';
  const wsPath = folders[0].uri.fsPath;
  const parts = wsPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'unknown';
}
