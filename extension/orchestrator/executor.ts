import * as vscode from 'vscode';
import type { ProviderRegistry } from '../providers/registry';
import type { ChatMessage } from '../providers/types';
import { ContextCompiler } from '../context/compiler';
import type { PlanStep, ExecutionResult, OrchestratorEventHandler } from './types';
import type { ToolRunner } from '../tools/runner';
import type { AuditLogger } from '../audit/logger';
import { createPatch } from '../audit/diff';

const MAX_TOOL_ITERATIONS = 15;
const MAX_ARG_SIZE_BYTES = 512_000; // 500KB limit per tool call arguments
const MAX_CONSECUTIVE_FAILURES = 3;

export class Executor {
  private toolRunner?: ToolRunner;
  private auditLogger?: AuditLogger;

  constructor(
    private registry: ProviderRegistry,
    private compiler: ContextCompiler,
    toolRunner?: ToolRunner,
  ) {
    this.toolRunner = toolRunner;
  }

  setAuditLogger(logger: AuditLogger): void {
    this.auditLogger = logger;
  }

  async executeStep(
    step: PlanStep,
    relevantCode: string,
    onEvent?: OrchestratorEventHandler,
    signal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const roleConfig = this.registry.getByRole('executor');
    if (!roleConfig) {
      throw new Error('No executor model configured. Set crucible.roles.executor in settings.');
    }

    const compiled = this.compiler.compileForExecutor(
      step.goal,
      step.files,
      relevantCode,
      step.constraints,
    );

    const toolDefs = this.toolRunner?.getToolDefinitions() ?? [];
    const validToolNames = new Set(toolDefs.map((t) => t.function.name));
    const toolInstructions = toolDefs.length > 0
      ? `\n\nYou have tools available. To call a tool, wrap the call in XML tags:\n<tool_call>\n{"name": "tool_name", "arguments": {"arg": "value"}}\n</tool_call>\n\nAvailable tools: ${toolDefs.map((t) => t.function.name).join(', ')}`
      : '';

    const messages: ChatMessage[] = [
      { role: 'system', content: compiled.systemPrefix + toolInstructions },
      { role: 'user', content: compiled.userMessage },
    ];

    let iteration = 0;
    let lastResponse = '';
    let consecutiveFailures = 0;
    // The step is done when the model stops asking for tools. Bailing out early
    // (abort, iteration cap, circuit breaker) is never a success.
    let completedNaturally = false;
    const allFilesChanged: string[] = [];
    const fileSnapshots = new Map<string, string>();
    const diffs: string[] = [];

    while (iteration < MAX_TOOL_ITERATIONS) {
      if (signal?.aborted) break;
      iteration++;

      try {
        this.auditLogger?.log('llm_request', {
          stepId: step.id,
          iteration,
          messageCount: messages.length,
          model: roleConfig.model,
        });

        let fullResponse = '';
        const stream = roleConfig.provider.streamChat(messages, {
          model: roleConfig.model,
          temperature: 0.1,
          tools: toolDefs.length > 0 ? toolDefs.map((t) => t.function as any) : undefined,
        });

        for await (const token of stream) {
          fullResponse += token;
          onEvent?.({ type: 'streamToken', data: { role: 'executor', token, stepId: step.id } });
        }

        lastResponse = fullResponse;
        this.auditLogger?.log('llm_response', { stepId: step.id, iteration, response: fullResponse });

        const toolCalls = parseToolCalls(fullResponse, validToolNames, this.auditLogger);
        if (toolCalls.length === 0 || !this.toolRunner) {
          completedNaturally = true;
          break;
        }

        for (const call of toolCalls) {
          // Capture file content before write for diff generation
          if ((call.name === 'write_file' || call.name === 'edit_file') && call.arguments.path) {
            const filePath = call.arguments.path as string;
            if (!fileSnapshots.has(filePath)) {
              try {
                const uris = await vscode.workspace.findFiles(filePath, '**/node_modules/**', 1);
                if (uris.length > 0) {
                  const doc = await vscode.workspace.openTextDocument(uris[0]);
                  fileSnapshots.set(filePath, doc.getText());
                } else {
                  fileSnapshots.set(filePath, '');
                }
              } catch {
                fileSnapshots.set(filePath, '');
              }
            }
          }

          const result = await this.toolRunner.executeTool(call.name, call.arguments, onEvent);

          if (result.success) {
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              this.auditLogger?.log('error', {
                stepId: step.id,
                message: `Circuit breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive tool failures`,
              });
              return {
                stepId: step.id,
                success: false,
                error: `Aborted: ${MAX_CONSECUTIVE_FAILURES} consecutive tool call failures`,
                filesChanged: allFilesChanged,
              };
            }
          }

          messages.push({
            role: 'assistant',
            content: fullResponse,
          });
          messages.push({
            role: 'tool',
            content: result.success
              ? result.output
              : `Error: ${result.error}`,
            name: call.name,
          });

          if (call.name === 'write_file' || call.name === 'edit_file') {
            const filePath = call.arguments.path as string;
            if (filePath && !allFilesChanged.includes(filePath)) {
              allFilesChanged.push(filePath);
            }

            // Generate real diff after successful write
            if (result.success && filePath) {
              try {
                const uris = await vscode.workspace.findFiles(filePath, '**/node_modules/**', 1);
                if (uris.length > 0) {
                  const doc = await vscode.workspace.openTextDocument(uris[0]);
                  const newContent = doc.getText();
                  const oldContent = fileSnapshots.get(filePath) ?? '';
                  if (oldContent !== newContent) {
                    diffs.push(createPatch(filePath, oldContent, newContent));
                    fileSnapshots.set(filePath, newContent);
                  }
                }
              } catch {
                // Non-critical: diff generation failed
              }
            }
          }
        }
      } catch (err: any) {
        this.auditLogger?.log('error', { stepId: step.id, iteration, error: err.message });
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return {
            stepId: step.id,
            success: false,
            error: `Aborted after ${iteration} iterations: ${err.message}`,
            filesChanged: allFilesChanged,
          };
        }
      }
    }

    const filesFromResponse = extractFileReferences(lastResponse);
    const allFiles = [...new Set([...allFilesChanged, ...filesFromResponse])];
    const diff = diffs.length > 0 ? diffs.join('\n\n') : undefined;

    if (!completedNaturally) {
      return {
        stepId: step.id,
        success: false,
        error: signal?.aborted
          ? 'Step aborted before completion'
          : `Step did not converge within ${MAX_TOOL_ITERATIONS} tool iterations`,
        diff,
        filesChanged: allFiles,
      };
    }

    return {
      stepId: step.id,
      success: true,
      diff,
      filesChanged: allFiles,
    };
  }
}

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function parseToolCalls(
  response: string,
  validToolNames?: Set<string>,
  auditLogger?: AuditLogger,
): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = pattern.exec(response)) !== null) {
    const raw = match[1].trim();

    // Reject oversized payloads
    if (raw.length > MAX_ARG_SIZE_BYTES) {
      const msg = `Rejected tool call: payload exceeds ${MAX_ARG_SIZE_BYTES} bytes (got ${raw.length})`;
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, rawLength: raw.length });
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      const msg = `Malformed tool call JSON: ${err.message}`;
      console.warn(`[Crucible] ${msg}`, raw.slice(0, 200));
      auditLogger?.log('error', { message: msg, rawPreview: raw.slice(0, 500) });
      continue;
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      const msg = 'Tool call missing or invalid "name" field';
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, parsed });
      continue;
    }

    // Validate tool name against registered set
    if (validToolNames && !validToolNames.has(parsed.name)) {
      const msg = `Rejected unknown tool "${parsed.name}". Valid: ${[...validToolNames].join(', ')}`;
      console.warn(`[Crucible] ${msg}`);
      auditLogger?.log('error', { message: msg, toolName: parsed.name });
      continue;
    }

    calls.push({
      name: parsed.name,
      arguments: parsed.arguments || {},
    });
  }

  return calls;
}

function extractFileReferences(response: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /```[\w]*\s*\/\/\s*([\w./\-]+)/g,
    /File:\s*([\w./\-]+)/gi,
    /`([\w./\-]+\.\w+)`/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      files.add(match[1]);
    }
  }

  return Array.from(files);
}
