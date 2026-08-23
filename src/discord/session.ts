import { config } from "../config";

const BOT_MENTION_RE = /^<@!?(\d{17,20})>\s*/;
const LEADING_MENTION_RE = /^<@!?(\d{17,20})>\s*/;

export const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_SESSION_LOCK_TTL_MS = 30 * 1000;
export const DEFAULT_MAX_SESSION_TURNS = 8;

export type SessionDecisionReason =
  | "bot_message"
  | "missing_guild"
  | "empty_prompt"
  | "foreign_mention"
  | "no_active_session"
  | "session_busy"
  | "max_turns_reached";

export type SessionDecision =
  | {
      shouldHandle: false;
      reason: SessionDecisionReason;
      mentioned: boolean;
      prompt: string;
      session?: ConversationSession;
    }
  | {
      shouldHandle: true;
      kind: "start" | "continue";
      mentioned: boolean;
      replyToBot: boolean;
      prompt: string;
      session: ConversationSession;
    };

export type IncomingSessionMessage = {
  messageId: string;
  guildId?: string | null;
  channelId: string;
  authorId: string;
  authorIsBot?: boolean;
  content: string;
  referencedMessageId?: string | null;
  createdAt?: Date | number;
};

export type ConversationSession = {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  openedByMessageId: string;
  lastUserMessageId: string;
  lastBotMessageId?: string;
  lastRequestId?: string;
  openedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  turnCount: number;
  lockedAt?: Date;
};

export type SessionStoreOptions = {
  ttlMs?: number;
  lockTtlMs?: number;
  maxTurns?: number;
};

export type FinishTurnInput = {
  requestId?: string;
  botMessageId?: string;
  now?: Date | number;
  close?: boolean;
};

export function stripLeadingBotMention(
  content: string,
  botUserId: string,
): { mentioned: boolean; prompt: string; mentionedUserId?: string } {
  const match = BOT_MENTION_RE.exec(content);
  if (!match) {
    return { mentioned: false, prompt: content.trim() };
  }

  const mentionedUserId = match[1];
  return {
    mentioned: mentionedUserId === botUserId,
    mentionedUserId,
    prompt: content.slice(match[0].length).trim(),
  };
}

export class MemoryConversationSessionStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly ttlMs: number;
  private readonly lockTtlMs: number;
  private readonly maxTurns: number;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_SESSION_LOCK_TTL_MS;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_SESSION_TURNS;
  }

  resolveMessage(message: IncomingSessionMessage, botUserId: string): SessionDecision {
    const now = toDate(message.createdAt);
    const mention = stripLeadingBotMention(message.content, botUserId);
    const prompt = mention.mentioned ? mention.prompt : message.content.trim();

    if (message.authorIsBot) {
      return { shouldHandle: false, reason: "bot_message", mentioned: mention.mentioned, prompt };
    }
    if (!message.guildId) {
      return { shouldHandle: false, reason: "missing_guild", mentioned: mention.mentioned, prompt };
    }

    const sessionId = sessionKey(message.guildId, message.channelId, message.authorId);
    const existing = this.getActiveSession(sessionId, now);
    const replyToBot =
      !!existing?.lastBotMessageId && message.referencedMessageId === existing.lastBotMessageId;

    if (!mention.mentioned && hasForeignLeadingMention(message.content, botUserId) && !replyToBot) {
      return {
        shouldHandle: false,
        reason: "foreign_mention",
        mentioned: false,
        prompt,
        session: existing,
      };
    }

    if (!prompt) {
      if (mention.mentioned) {
        const session = this.openOrRefreshSession(
          message.guildId,
          message.channelId,
          message.authorId,
          message.messageId,
          now,
        );
        return { shouldHandle: false, reason: "empty_prompt", mentioned: true, prompt, session: { ...session } };
      }
      return {
        shouldHandle: false,
        reason: "empty_prompt",
        mentioned: false,
        prompt,
        session: existing,
      };
    }

    if (mention.mentioned) {
      const session = this.openOrRefreshSession(
        message.guildId,
        message.channelId,
        message.authorId,
        message.messageId,
        now,
      );
      this.lock(session, now);
      return {
        shouldHandle: true,
        kind: "start",
        mentioned: true,
        replyToBot,
        prompt,
        session: { ...session },
      };
    }

    if (!existing) {
      return { shouldHandle: false, reason: "no_active_session", mentioned: false, prompt };
    }
    if (this.isBusy(existing, now)) {
      return {
        shouldHandle: false,
        reason: "session_busy",
        mentioned: false,
        prompt,
        session: { ...existing },
      };
    }
    if (existing.turnCount >= this.maxTurns) {
      this.sessions.delete(existing.id);
      return {
        shouldHandle: false,
        reason: "max_turns_reached",
        mentioned: false,
        prompt,
        session: { ...existing },
      };
    }

    existing.lastUserMessageId = message.messageId;
    existing.updatedAt = now;
    existing.expiresAt = expiresAt(now, this.ttlMs);
    existing.turnCount += 1;
    this.lock(existing, now);

    return {
      shouldHandle: true,
      kind: "continue",
      mentioned: false,
      replyToBot,
      prompt,
      session: { ...existing },
    };
  }

  finishTurn(sessionId: string, input: FinishTurnInput = {}): ConversationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (input.close) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    const now = toDate(input.now);
    session.updatedAt = now;
    session.expiresAt = expiresAt(now, this.ttlMs);
    session.lockedAt = undefined;
    if (input.requestId) session.lastRequestId = input.requestId;
    if (input.botMessageId) session.lastBotMessageId = input.botMessageId;
    return { ...session };
  }

  abandonTurn(sessionId: string): ConversationSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.lockedAt = undefined;
    return { ...session };
  }

  getSession(guildId: string, channelId: string, userId: string, nowInput?: Date | number): ConversationSession | undefined {
    const session = this.getActiveSession(sessionKey(guildId, channelId, userId), toDate(nowInput));
    return session ? { ...session } : undefined;
  }

  closeSession(guildId: string, channelId: string, userId: string): void {
    this.sessions.delete(sessionKey(guildId, channelId, userId));
  }

  sweepExpired(nowInput?: Date | number): number {
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

  size(): number {
    return this.sessions.size;
  }

  private openOrRefreshSession(
    guildId: string,
    channelId: string,
    userId: string,
    messageId: string,
    now: Date,
  ): ConversationSession {
    const id = sessionKey(guildId, channelId, userId);
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastUserMessageId = messageId;
      existing.openedByMessageId = messageId;
      existing.updatedAt = now;
      existing.expiresAt = expiresAt(now, this.ttlMs);
      existing.turnCount = 1;
      existing.lastBotMessageId = undefined;
      existing.lastRequestId = undefined;
      existing.lockedAt = undefined;
      return existing;
    }

    const session: ConversationSession = {
      id,
      guildId,
      channelId,
      userId,
      openedByMessageId: messageId,
      lastUserMessageId: messageId,
      openedAt: now,
      updatedAt: now,
      expiresAt: expiresAt(now, this.ttlMs),
      turnCount: 1,
    };
    this.sessions.set(id, session);
    return session;
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

  private isBusy(session: ConversationSession, now: Date): boolean {
    if (!session.lockedAt) return false;
    return now.getTime() - session.lockedAt.getTime() < this.lockTtlMs;
  }

  private lock(session: ConversationSession, now: Date): void {
    session.lockedAt = now;
  }
}

export const discordConversationSessions = new MemoryConversationSessionStore({
  ttlMs: config.CONVERSATION_SESSION_TIMEOUT_MINUTES * 60 * 1000,
  lockTtlMs: Math.max(config.LLM_TIMEOUT_MS * 2, DEFAULT_SESSION_LOCK_TTL_MS),
});

function sessionKey(guildId: string, channelId: string, userId: string): string {
  return `${guildId}:${channelId}:${userId}`;
}

function hasForeignLeadingMention(content: string, botUserId: string): boolean {
  const match = LEADING_MENTION_RE.exec(content);
  return !!match && match[1] !== botUserId;
}

function expiresAt(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}

function toDate(input?: Date | number): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  return new Date();
}
