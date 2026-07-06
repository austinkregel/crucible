import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type AuditEntryType =
  | 'tool_call_start'
  | 'tool_call_end'
  | 'tool_call_error'
  | 'llm_request'
  | 'llm_response'
  | 'llm_stream_complete'
  | 'phase_change'
  | 'plan_generated'
  | 'validation'
  | 'user_input'
  | 'approval_prompt'
  | 'approval_result'
  | 'session_start'
  | 'session_end'
  | 'subagent_start'
  | 'subagent_end'
  | 'compaction_start'
  | 'compaction_end'
  | 'error';

export interface AuditEntry {
  timestamp: number;
  sessionId: string;
  type: AuditEntryType;
  data: Record<string, unknown>;
}

const AUDIT_DIR = path.join(os.homedir(), '.crucible', 'audit');

export class AuditLogger {
  private sessionId: string;
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    this.filePath = path.join(AUDIT_DIR, `${sessionId}.jsonl`);
  }

  log(type: AuditEntryType, data: Record<string, unknown>): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      sessionId: this.sessionId,
      type,
      data,
    };

    const line = JSON.stringify(entry) + '\n';

    this.writeQueue = this.writeQueue.then(() => {
      return new Promise<void>((resolve) => {
        fs.appendFile(this.filePath, line, (err) => {
          if (err) {
            console.warn('[Crucible Audit] Failed to write audit entry:', err.message);
          }
          resolve();
        });
      });
    });
  }

  getFilePath(): string {
    return this.filePath;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  static listSessions(): Array<{ sessionId: string; filePath: string; mtime: number }> {
    if (!fs.existsSync(AUDIT_DIR)) return [];

    return fs.readdirSync(AUDIT_DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const filePath = path.join(AUDIT_DIR, f);
        const stat = fs.statSync(filePath);
        return {
          sessionId: f.replace('.jsonl', ''),
          filePath,
          mtime: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  static readSession(sessionId: string): AuditEntry[] {
    const filePath = path.join(AUDIT_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const entries: AuditEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  }
}
