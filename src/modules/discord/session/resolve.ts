import { hasForeignLeadingMention, stripLeadingBotMention } from "./mention";
import {
  type ConversationSession,
  type FinishTurnInput,
  type IncomingSessionMessage,
  type SessionDecision,
} from "./types";

/**
 * Pure decision core shared by every ConversationSessionStore implementation.
 *
 * Each store owns its own I/O (a Map for memory, a transaction for
 * Postgres), but the branching that decides what a message means - open a
 * session, continue one, reject as busy, close on max turns - lives here
 * exactly once. A store's only job is: load the current row for this
 * session key (already pruned for expiry), call the matching `compute*`
 * function, then apply the `write` it returns. That keeps the two stores
 * bit-for-bit identical in behaviour instead of two hand-synced copies of
 * the same branching logic.
 */

export type SessionWrite =
  | { kind: "none" }
  | { kind: "delete"; id: string }
  | { kind: "upsert"; session: ConversationSession };

export type ResolveOptions = {
  ttlMs: number;
  lockTtlMs: number;
  maxTurns: number;
};

export type ResolveOutcome = {
  decision: SessionDecision;
  write: SessionWrite;
};

export function sessionKey(guildId: string, channelId: string, userId: string): string {
  return `${guildId}:${channelId}:${userId}`;
}

/** Inverse of sessionKey - Discord snowflakes never contain ":", so this is lossless. */
export function parseSessionKey(
  id: string,
): { guildId: string; channelId: string; userId: string } | undefined {
  const [guildId, channelId, userId] = id.split(":");
  if (!guildId || !channelId || !userId) return undefined;
  return { guildId, channelId, userId };
}

export function computeResolveMessage(
  message: IncomingSessionMessage,
  botUserId: string,
  existing: ConversationSession | undefined,
  now: Date,
  opts: ResolveOptions,
): ResolveOutcome {
  const mention = stripLeadingBotMention(message.content, botUserId);
  const prompt = mention.mentioned ? mention.prompt : message.content.trim();

  if (message.authorIsBot) {
    return {
      decision: { shouldHandle: false, reason: "bot_message", mentioned: mention.mentioned, prompt },
      write: { kind: "none" },
    };
  }
  if (!message.guildId) {
    return {
      decision: { shouldHandle: false, reason: "missing_guild", mentioned: mention.mentioned, prompt },
      write: { kind: "none" },
    };
  }

  const replyToBot =
    !!existing?.lastBotMessageId && message.referencedMessageId === existing.lastBotMessageId;

  if (!mention.mentioned && hasForeignLeadingMention(message.content, botUserId) && !replyToBot) {
    return {
      decision: { shouldHandle: false, reason: "foreign_mention", mentioned: false, prompt, session: existing },
      write: { kind: "none" },
    };
  }

  if (!prompt) {
    if (mention.mentioned) {
      const session = openOrRefresh(message, existing, now, opts);
      return {
        decision: { shouldHandle: false, reason: "empty_prompt", mentioned: true, prompt, session: { ...session } },
        write: { kind: "upsert", session },
      };
    }
    return {
      decision: { shouldHandle: false, reason: "empty_prompt", mentioned: false, prompt, session: existing },
      write: { kind: "none" },
    };
  }

  if (mention.mentioned) {
    const opened = openOrRefresh(message, existing, now, opts);
    const locked = { ...opened, lockedAt: now };
    return {
      decision: {
        shouldHandle: true,
        kind: "start",
        mentioned: true,
        replyToBot,
        prompt,
        session: { ...locked },
      },
      write: { kind: "upsert", session: locked },
    };
  }

  if (!existing) {
    return {
      decision: { shouldHandle: false, reason: "no_active_session", mentioned: false, prompt },
      write: { kind: "none" },
    };
  }
  if (isBusy(existing, now, opts.lockTtlMs)) {
    return {
      decision: {
        shouldHandle: false,
        reason: "session_busy",
        mentioned: false,
        prompt,
        session: { ...existing },
      },
      write: { kind: "none" },
    };
  }
  if (existing.turnCount >= opts.maxTurns) {
    return {
      decision: {
        shouldHandle: false,
        reason: "max_turns_reached",
        mentioned: false,
        prompt,
        session: { ...existing },
      },
      write: { kind: "delete", id: existing.id },
    };
  }

  const continued: ConversationSession = {
    ...existing,
    lastUserMessageId: message.messageId,
    updatedAt: now,
    expiresAt: expiresAt(now, opts.ttlMs),
    turnCount: existing.turnCount + 1,
    lockedAt: now,
  };
  return {
    decision: {
      shouldHandle: true,
      kind: "continue",
      mentioned: false,
      replyToBot,
      prompt,
      session: { ...continued },
    },
    write: { kind: "upsert", session: continued },
  };
}

export function computeFinishTurn(
  existing: ConversationSession | undefined,
  input: FinishTurnInput,
  now: Date,
  ttlMs: number,
): { result: ConversationSession | undefined; write: SessionWrite } {
  if (!existing) return { result: undefined, write: { kind: "none" } };
  if (input.close) return { result: undefined, write: { kind: "delete", id: existing.id } };

  const updated: ConversationSession = {
    ...existing,
    updatedAt: now,
    expiresAt: expiresAt(now, ttlMs),
    lockedAt: undefined,
    ...(input.requestId ? { lastRequestId: input.requestId } : {}),
    ...(input.botMessageId ? { lastBotMessageId: input.botMessageId } : {}),
  };
  return { result: { ...updated }, write: { kind: "upsert", session: updated } };
}

export function computeAbandonTurn(
  existing: ConversationSession | undefined,
): { result: ConversationSession | undefined; write: SessionWrite } {
  if (!existing) return { result: undefined, write: { kind: "none" } };
  const updated: ConversationSession = { ...existing, lockedAt: undefined };
  return { result: { ...updated }, write: { kind: "upsert", session: updated } };
}

function openOrRefresh(
  message: IncomingSessionMessage,
  existing: ConversationSession | undefined,
  now: Date,
  opts: ResolveOptions,
): ConversationSession {
  if (existing) {
    return {
      ...existing,
      lastUserMessageId: message.messageId,
      openedByMessageId: message.messageId,
      updatedAt: now,
      expiresAt: expiresAt(now, opts.ttlMs),
      turnCount: 1,
      lastBotMessageId: undefined,
      lastRequestId: undefined,
      lockedAt: undefined,
    };
  }

  return {
    id: sessionKey(message.guildId!, message.channelId, message.authorId),
    guildId: message.guildId!,
    channelId: message.channelId,
    userId: message.authorId,
    openedByMessageId: message.messageId,
    lastUserMessageId: message.messageId,
    openedAt: now,
    updatedAt: now,
    expiresAt: expiresAt(now, opts.ttlMs),
    turnCount: 1,
  };
}

function isBusy(session: ConversationSession, now: Date, lockTtlMs: number): boolean {
  if (!session.lockedAt) return false;
  return now.getTime() - session.lockedAt.getTime() < lockTtlMs;
}

function expiresAt(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}

export function toDate(input?: Date | number): Date {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  return new Date();
}
