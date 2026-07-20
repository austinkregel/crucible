import * as vscode from 'vscode';
import type { ProviderRegistry } from '../providers/registry';
import { ContextCompiler } from '../context/compiler';
import { ContextCollector } from '../context/collector';
import type { CollectedContext } from '../context/collector';
import { CacheStore } from '../cache/store';
import { RollingMemory } from '../cache/rollingMemory';
import type { ProjectGrounding } from '../context/projectGrounding';
import type { Retriever } from '../retrieval/retriever';
import { getRecentFiles } from '../retrieval/retriever';
import { Planner } from './planner';
import { Validator } from './validator';
import { Executor } from './executor';
import { PostValidator } from './postValidator';
import type { Plan, ValidationResult, ExecutionResult, OrchestratorEventHandler } from './types';
import type { ToolRunner } from '../tools/runner';
import type { AuditLogger } from '../audit/logger';
import type { ModelRole } from '../providers/types';
import { OllamaProvider } from '../providers/ollama';

/** Bounds on semantic-retrieval augmentation (this path has no token budget). */
const RETRIEVAL_PLANNING_LIMIT = 6;
const RETRIEVAL_EXECUTION_LIMIT = 4;
const RETRIEVAL_CHUNK_CHAR_CAP = 1500;

export class Orchestrator {
  private planner: Planner;
  private validator: Validator;
  private executor: Executor;
  private postValidator: PostValidator;
  private collector: ContextCollector;
  private rollingMemory: RollingMemory;
  private retriever?: Retriever;

  constructor(
    private registry: ProviderRegistry,
    store: CacheStore,
    toolRunner?: ToolRunner,
    grounding?: ProjectGrounding,
  ) {
    this.rollingMemory = new RollingMemory(store);
    const compiler = new ContextCompiler(this.rollingMemory, grounding);
    this.planner = new Planner(registry, compiler);
    this.validator = new Validator(registry, compiler);
    this.executor = new Executor(registry, compiler, toolRunner);
    this.postValidator = new PostValidator(registry, grounding);
    this.collector = new ContextCollector(store);
  }

  setAuditLogger(logger: AuditLogger): void {
    this.executor.setAuditLogger(logger);
  }

  /**
   * Wire in semantic retrieval. Optional and set late (the retriever is only
   * built once indexing initializes), so every use is guarded and best-effort.
   */
  setRetrieval(retriever: Retriever): void {
    this.retriever = retriever;
  }

  /**
   * Append semantically-retrieved code chunks to a collected context so the
   * planner/validator/executor see relevant code the user never @mentioned.
   * Mutates context.files in place; bounded in count and per-chunk size
   * because this prompt path has no budget enforcement. Never throws --
   * retrieval failure must not break orchestration.
   */
  private async augmentWithRetrieval(
    query: string,
    context: CollectedContext,
    limit: number,
  ): Promise<void> {
    if (!this.retriever) return;

    let chunks;
    try {
      chunks = await this.retriever.retrieve(query, {
        limit,
        activeFilePath: vscode.window.activeTextEditor?.document.uri.fsPath,
        mentions: context.mentions,
        recentFiles: getRecentFiles(),
      });
    } catch {
      return;
    }

    const seen = new Set(context.files.map((f) => f.path));
    for (const chunk of chunks) {
      const label = `${chunk.relativePath}:${chunk.lineStart}-${chunk.lineEnd}`;
      if (seen.has(label)) continue;
      seen.add(label);
      context.files.push({
        path: label,
        content: capChars(chunk.content, RETRIEVAL_CHUNK_CHAR_CAP),
        language: chunk.language,
      });
    }
  }

  /**
   * Pre-flight check: verify that the models for the given roles are reachable
   * before starting a potentially long orchestration flow.
   */
  private async preflightCheck(
    roles: ModelRole[],
    onEvent: OrchestratorEventHandler,
  ): Promise<boolean> {
    for (const role of roles) {
      const roleConfig = this.registry.getByRole(role);
      if (!roleConfig) continue;

      const provider = roleConfig.provider;
      if (provider instanceof OllamaProvider) {
        const check = await provider.ensureModelReady(roleConfig.model);
        if (!check.ready && check.error) {
          onEvent({
            type: 'error',
            data: {
              message: check.error.message,
              suggestion: check.error.suggestion,
              errorKind: check.error.kind,
              model: check.error.model,
              role,
            },
          });
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Plan-only mode: runs the planner + validator adversarial loop and returns
   * the validated plan without executing any steps.
   */
  async runPlanOnly(
    userQuery: string,
    additionalPaths: string[],
    onEvent: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('crucible');
    const confidenceThreshold = config.get<number>('adversarial.confidenceThreshold', 0.7);
    const maxIterations = config.get<number>('adversarial.maxIterations', 3);

    try {
      const ready = await this.preflightCheck(['planner', 'validator'], onEvent);
      if (!ready) return;

      if (signal?.aborted) return;
      const context = await this.collector.collect(userQuery, additionalPaths);
      await this.augmentWithRetrieval(userQuery, context, RETRIEVAL_PLANNING_LIMIT);

      if (signal?.aborted) return;
      onEvent({ type: 'phaseStarted', data: { phase: 'planning' } });
      let plan = await this.planner.generatePlan(userQuery, context, onEvent);
      onEvent({ type: 'planGenerated', data: plan });

      if (signal?.aborted) return;
      onEvent({ type: 'phaseStarted', data: { phase: 'validation' } });
      let iteration = 0;
      let validation: ValidationResult | undefined;

      while (iteration < maxIterations) {
        if (signal?.aborted) return;
        validation = await this.validator.validate(plan, context, onEvent);
        validation.approved = validation.confidenceScore >= confidenceThreshold;

        onEvent({ type: 'validationComplete', data: validation });

        if (validation.approved) break;

        iteration++;
        if (iteration < maxIterations) {
          if (signal?.aborted) return;
          const critique = this.validator.formatCritique(validation);
          plan = await this.planner.refinePlan(plan, critique, context, onEvent);
          onEvent({ type: 'planRefined', data: { plan, iteration } });
        }
      }

      onEvent({
        type: 'planComplete',
        data: {
          plan,
          validation,
          approved: validation?.approved ?? false,
        },
      });
    } catch (err: any) {
      if (signal?.aborted) return;
      onEvent({ type: 'error', data: { message: err.message } });
    }
  }

  /**
   * Agent mode with an existing plan: skips planning/validation, executes
   * the provided plan steps directly.
   */
  async runAgentWithPlan(
    plan: Plan,
    onEvent: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('crucible');
    const enablePostValidation = config.get<boolean>('adversarial.postValidation', true);

    const rolesToCheck: ModelRole[] = enablePostValidation
      ? ['executor', 'postValidator']
      : ['executor'];

    try {
      const ready = await this.preflightCheck(rolesToCheck, onEvent);
      if (!ready) return;

      onEvent({ type: 'phaseStarted', data: { phase: 'execution' } });
      const executionResults: ExecutionResult[] = [];

      for (const step of plan.steps) {
        if (signal?.aborted) return;
        step.status = 'running';
        onEvent({ type: 'stepStarted', data: { stepId: step.id, step } });

        try {
          const stepContext = await this.collector.collect(step.goal, step.files);
          await this.augmentWithRetrieval(step.goal, stepContext, RETRIEVAL_EXECUTION_LIMIT);
          const relevantCode = stepContext.files
            .map((f) => `### ${f.path}\n${f.content || f.summary || '(not available)'}`)
            .join('\n\n');

          const result = await this.executor.executeStep(step, relevantCode, onEvent, signal);
          executionResults.push(result);
          step.status = result.success ? 'done' : 'failed';
          step.result = result.diff;

          // executeStep signals failure by returning success:false, not by throwing.
          onEvent({
            type: result.success ? 'stepCompleted' : 'stepFailed',
            data: result,
          });
        } catch (err: any) {
          if (signal?.aborted) return;
          step.status = 'failed';
          const result: ExecutionResult = {
            stepId: step.id,
            success: false,
            error: err.message,
            filesChanged: [],
          };
          executionResults.push(result);
          onEvent({ type: 'stepFailed', data: result });
        }
      }

      if (signal?.aborted) return;
      if (enablePostValidation) {
        onEvent({ type: 'phaseStarted', data: { phase: 'postValidation' } });
        const postResult = await this.postValidator.validate(plan, executionResults, onEvent);
        onEvent({ type: 'postValidationComplete', data: postResult });
      }

      this.rollingMemory.add({
        type: 'intent',
        content: `Implemented: ${plan.plan}`,
      });

      onEvent({ type: 'complete', data: { plan, executionResults } });
    } catch (err: any) {
      if (signal?.aborted) return;
      onEvent({ type: 'error', data: { message: err.message } });
    }
  }

  async runAgent(
    userQuery: string,
    additionalPaths: string[],
    onEvent: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('crucible');
    const confidenceThreshold = config.get<number>('adversarial.confidenceThreshold', 0.7);
    const maxIterations = config.get<number>('adversarial.maxIterations', 3);
    const enablePostValidation = config.get<boolean>('adversarial.postValidation', true);

    const rolesToCheck: ModelRole[] = enablePostValidation
      ? ['planner', 'validator', 'executor', 'postValidator']
      : ['planner', 'validator', 'executor'];

    try {
      const ready = await this.preflightCheck(rolesToCheck, onEvent);
      if (!ready) return;

      if (signal?.aborted) return;
      const context = await this.collector.collect(userQuery, additionalPaths);
      await this.augmentWithRetrieval(userQuery, context, RETRIEVAL_PLANNING_LIMIT);

      // Phase 1: Planning
      if (signal?.aborted) return;
      onEvent({ type: 'phaseStarted', data: { phase: 'planning' } });
      let plan = await this.planner.generatePlan(userQuery, context, onEvent);
      onEvent({ type: 'planGenerated', data: plan });

      // Phase 2: Validation
      if (signal?.aborted) return;
      onEvent({ type: 'phaseStarted', data: { phase: 'validation' } });
      let iteration = 0;
      let validation: ValidationResult | undefined;

      while (iteration < maxIterations) {
        if (signal?.aborted) return;
        validation = await this.validator.validate(plan, context, onEvent);
        validation.approved = validation.confidenceScore >= confidenceThreshold;

        onEvent({ type: 'validationComplete', data: validation });

        if (validation.approved) break;

        iteration++;
        if (iteration < maxIterations) {
          if (signal?.aborted) return;
          const critique = this.validator.formatCritique(validation);
          plan = await this.planner.refinePlan(plan, critique, context, onEvent);
          onEvent({ type: 'planRefined', data: { plan, iteration } });
        }
      }

      if (validation && !validation.approved) {
        onEvent({
          type: 'error',
          data: {
            message: `Plan could not reach confidence threshold (${confidenceThreshold}) after ${maxIterations} iterations.`,
            lastValidation: validation,
          },
        });
        return;
      }

      // Phase 3: Execution
      if (signal?.aborted) return;
      onEvent({ type: 'phaseStarted', data: { phase: 'execution' } });
      const executionResults: ExecutionResult[] = [];

      for (const step of plan.steps) {
        if (signal?.aborted) return;
        step.status = 'running';
        onEvent({ type: 'stepStarted', data: { stepId: step.id, step } });

        try {
          const stepContext = await this.collector.collect(step.goal, step.files);
          await this.augmentWithRetrieval(step.goal, stepContext, RETRIEVAL_EXECUTION_LIMIT);
          const relevantCode = stepContext.files
            .map((f) => `### ${f.path}\n${f.content || f.summary || '(not available)'}`)
            .join('\n\n');

          const result = await this.executor.executeStep(step, relevantCode, onEvent, signal);
          executionResults.push(result);
          step.status = result.success ? 'done' : 'failed';
          step.result = result.diff;

          // executeStep signals failure by returning success:false, not by throwing.
          onEvent({
            type: result.success ? 'stepCompleted' : 'stepFailed',
            data: result,
          });
        } catch (err: any) {
          if (signal?.aborted) return;
          step.status = 'failed';
          const result: ExecutionResult = {
            stepId: step.id,
            success: false,
            error: err.message,
            filesChanged: [],
          };
          executionResults.push(result);
          onEvent({ type: 'stepFailed', data: result });
        }
      }

      // Phase 4: Post-validation
      if (signal?.aborted) return;
      if (enablePostValidation) {
        onEvent({ type: 'phaseStarted', data: { phase: 'postValidation' } });
        const postResult = await this.postValidator.validate(plan, executionResults, onEvent);
        onEvent({ type: 'postValidationComplete', data: postResult });
      }

      this.rollingMemory.add({
        type: 'intent',
        content: `Implemented: ${plan.plan}`,
      });

      onEvent({ type: 'complete', data: { plan, executionResults } });
    } catch (err: any) {
      if (signal?.aborted) return;
      onEvent({ type: 'error', data: { message: err.message } });
    }
  }
}

/** Truncate a retrieved chunk to a char budget with an explicit marker. */
function capChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n… (truncated)`;
}
