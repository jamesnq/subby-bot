import {
  computeAbandonTurn,
  computeFinishTurn,
  computeResolveMessage,
  sessionKey,
  toDate,
  type SessionWrite,
} from "./resolve";
import {
  DEFAULT_MAX_SESSION_TURNS,
  DEFAULT_SESSION_LOCK_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
  type ConversationSession,
  type ConversationSessionStore,
  type FinishTurnInput,
  type IncomingSessionMessage,
  type SessionDecision,
  type SessionStoreOptions,
} from "./types";

export class MemoryConversationSessionStore implements ConversationSessionStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly ttlMs: number;
  private readonly lockTtlMs: number;
  private readonly maxTurns: number;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_SESSION_LOCK_TTL_MS;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_SESSION_TURNS;
  }

  async resolveMessage(message: IncomingSessionMessage, botUserId: string): Promise<SessionDecision> {
    const now = toDate(message.createdAt);
    const sessionId = message.guildId
      ? sessionKey(message.guildId, message.channelId, message.authorId)
      : undefined;
    const existing = sessionId ? this.getActiveSession(sessionId, now) : undefined;

    const { decision, write } = computeResolveMessage(message, botUserId, existing, now, {
      ttlMs: this.ttlMs,
      lockTtlMs: this.lockTtlMs,
      maxTurns: this.maxTurns,
    });
    this.applyWrite(write);
    return decision;
  }

  async finishTurn(
    sessionId: string,
    input: FinishTurnInput = {},
  ): Promise<ConversationSession | undefined> {
    const existing = this.sessions.get(sessionId);
    const { result, write } = computeFinishTurn(existing, input, toDate(input.now), this.ttlMs);
    this.applyWrite(write);
    return result;
  }

  async abandonTurn(sessionId: string): Promise<ConversationSession | undefined> {
    const existing = this.sessions.get(sessionId);
    const { result, write } = computeAbandonTurn(existing);
    this.applyWrite(write);
    return result;
  }

  async getSession(
    guildId: string,
    channelId: string,
    userId: string,
    nowInput?: Date | number,
  ): Promise<ConversationSession | undefined> {
    const session = this.getActiveSession(sessionKey(guildId, channelId, userId), toDate(nowInput));
    return session ? { ...session } : undefined;
  }

  async closeSession(guildId: string, channelId: string, userId: string): Promise<void> {
    this.sessions.delete(sessionKey(guildId, channelId, userId));
  }

  async sweepExpired(nowInput?: Date | number): Promise<number> {
    const now = toDate(nowInput);
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt.getTime() <= now.getTime()) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async size(): Promise<number> {
    return this.sessions.size;
  }

  private getActiveSession(sessionId: string, now: Date): ConversationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt.getTime() <= now.getTime()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  private applyWrite(write: SessionWrite): void {
    if (write.kind === "none") return;
    if (write.kind === "delete") {
      this.sessions.delete(write.id);
      return;
    }
    this.sessions.set(write.session.id, write.session);
  }
}
