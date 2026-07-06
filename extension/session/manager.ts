import { SessionHistory, type StoredSession, type StoredMessage, type StoredTokenUsage } from './history';

export class SessionManager {
  private history: SessionHistory;
  private currentSessionId: string;
  private currentMessages: StoredMessage[] = [];
  private currentMode = 'quick';

  constructor() {
    this.history = new SessionHistory();
    this.currentSessionId = generateSessionId();
  }

  getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  addMessage(message: StoredMessage): void {
    this.currentMessages.push(message);
    this.autoSave();
  }

  getMessages(): StoredMessage[] {
    return this.currentMessages;
  }

  getTotalTokens(): StoredTokenUsage {
    const totals: StoredTokenUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
    for (const msg of this.currentMessages) {
      if (!msg.tokens) continue;
      totals.inputTokens += msg.tokens.inputTokens;
      totals.outputTokens += msg.tokens.outputTokens;
      totals.reasoningTokens! += msg.tokens.reasoningTokens ?? 0;
      totals.cachedTokens! += msg.tokens.cachedTokens ?? 0;
    }
    return totals;
  }

  newSession(): string {
    this.autoSave();
    this.currentSessionId = generateSessionId();
    this.currentMessages = [];
    return this.currentSessionId;
  }

  setMode(mode: string): void {
    this.currentMode = mode;
  }

  loadSession(id: string): StoredSession | undefined {
    const session = this.history.load(id);
    if (session) {
      this.currentSessionId = session.id;
      this.currentMessages = session.messages;
      this.currentMode = session.mode;
    }
    return session;
  }

  listSessions() {
    return this.history.list();
  }

  deleteSession(id: string): void {
    this.history.delete(id);
  }

  archiveSession(id: string): void {
    this.history.archive(id);
  }

  unarchiveSession(id: string): void {
    this.history.unarchive(id);
  }

  listArchivedSessions() {
    return this.history.listArchived();
  }

  archiveStale(maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const sessions = this.history.list();
    let archived = 0;
    for (const session of sessions) {
      if (session.id === this.currentSessionId) continue;
      if (session.updatedAt < cutoff) {
        this.history.archive(session.id);
        archived++;
      }
    }
    return archived;
  }

  private autoSave(): void {
    if (this.currentMessages.length === 0) return;

    const title = this.deriveTitle();
    const session: StoredSession = {
      id: this.currentSessionId,
      title,
      messages: this.currentMessages,
      mode: this.currentMode,
      createdAt: this.currentMessages[0]?.timestamp || Date.now(),
      updatedAt: Date.now(),
    };

    this.history.save(session);
  }

  private deriveTitle(): string {
    const firstUser = this.currentMessages.find((m) => m.role === 'user');
    if (firstUser) {
      return firstUser.content.substring(0, 60) + (firstUser.content.length > 60 ? '...' : '');
    }
    return 'Untitled session';
  }
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}
