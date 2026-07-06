import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SESSIONS_DIR = path.join(os.homedir(), '.crucible', 'sessions');
const ARCHIVED_DIR = path.join(SESSIONS_DIR, 'archived');

export interface StoredTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface StoredMessage {
  role: string;
  content: string;
  model?: string;
  provider?: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: string;
  toolStatus?: string;
  phase?: string;
  tokens?: StoredTokenUsage;
  compacted?: boolean;
  summaryOf?: number;
}

export interface StoredSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  mode: string;
  createdAt: number;
  updatedAt: number;
}

export class SessionHistory {
  constructor() {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  save(session: StoredSession): void {
    const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  load(id: string): StoredSession | undefined {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }

  list(): Array<{ id: string; title: string; mode: string; updatedAt: number }> {
    if (!fs.existsSync(SESSIONS_DIR)) return [];

    return fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
          return { id: data.id, title: data.title, mode: data.mode || 'quick', updatedAt: data.updatedAt };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0)) as Array<{
        id: string;
        title: string;
        mode: string;
        updatedAt: number;
      }>;
  }

  delete(id: string): void {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  archive(id: string): void {
    const src = path.join(SESSIONS_DIR, `${id}.json`);
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(ARCHIVED_DIR, { recursive: true });
    const dest = path.join(ARCHIVED_DIR, `${id}.json`);
    fs.renameSync(src, dest);
  }

  unarchive(id: string): void {
    const src = path.join(ARCHIVED_DIR, `${id}.json`);
    if (!fs.existsSync(src)) return;
    const dest = path.join(SESSIONS_DIR, `${id}.json`);
    fs.renameSync(src, dest);
  }

  listArchived(): Array<{ id: string; title: string; mode: string; updatedAt: number }> {
    if (!fs.existsSync(ARCHIVED_DIR)) return [];

    return fs.readdirSync(ARCHIVED_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(ARCHIVED_DIR, f), 'utf-8'));
          return { id: data.id, title: data.title, mode: data.mode || 'quick', updatedAt: data.updatedAt };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0)) as Array<{
        id: string;
        title: string;
        mode: string;
        updatedAt: number;
      }>;
  }
}
