import { and, eq, lte, sql } from "drizzle-orm";

import { db } from "../../database/db";
import { conversationSessions, type ConversationSessionRow } from "../../database/schema";

import {
  computeAbandonTurn,
  computeFinishTurn,
  computeResolveMessage,
  parseSessionKey,
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

/** Drizzle's node-postgres transaction callback param - same query builder as `db`. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Postgres-backed mirror of MemoryConversationSessionStore, for
 * STATE_BACKEND=postgres. The branching that decides what a message means
 * lives once in ./resolve - this class only does the I/O: an advisory lock
 * scoped to the transaction serializes concurrent calls for the same
 * (guild, channel, user) triple, so a busy-turn check and the write that
 * follows it can never race against a second message arriving in the same
 * session.
 */
export class PostgresConversationSessionStore implements ConversationSessionStore {
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

    // Mirrors the memory store: these two reasons never look at existing
    // state, so they do not need a transaction at all.
    if (message.authorIsBot || !message.guildId) {
      return computeResolveMessage(message, botUserId, undefined, now, {
        ttlMs: this.ttlMs,
        lockTtlMs: this.lockTtlMs,
        maxTurns: this.maxTurns,
      }).decision;
    }

    const guildId = message.guildId;
    const id = sessionKey(guildId, message.channelId, message.authorId);

    return db.transaction(async (tx) => {
      await lockSession(tx, id);
      const existing = await loadActive(tx, guildId, message.channelId, message.authorId, now);

      const { decision, write } = computeResolveMessage(message, botUserId, existing, now, {
        ttlMs: this.ttlMs,
        lockTtlMs: this.lockTtlMs,
        maxTurns: this.maxTurns,
      });
      await applyWrite(tx, write);
      return decision;
    });
  }

  async finishTurn(
    sessionId: string,
    input: FinishTurnInput = {},
  ): Promise<ConversationSession | undefined> {
    const parsed = parseSessionKey(sessionId);
    if (!parsed) return undefined;
    const now = toDate(input.now);

    return db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const existing = await loadRaw(tx, parsed.guildId, parsed.channelId, parsed.userId);
      const { result, write } = computeFinishTurn(existing, input, now, this.ttlMs);
      await applyWrite(tx, write);
      return result;
    });
  }

  async abandonTurn(sessionId: string): Promise<ConversationSession | undefined> {
    const parsed = parseSessionKey(sessionId);
    if (!parsed) return undefined;

    return db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const existing = await loadRaw(tx, parsed.guildId, parsed.channelId, parsed.userId);
      const { result, write } = computeAbandonTurn(existing);
      await applyWrite(tx, write);
      return result;
    });
  }

  async getSession(
    guildId: string,
    channelId: string,
    userId: string,
    nowInput?: Date | number,
  ): Promise<ConversationSession | undefined> {
    return loadActive(db, guildId, channelId, userId, toDate(nowInput));
  }

  async closeSession(guildId: string, channelId: string, userId: string): Promise<void> {
    await db.delete(conversationSessions).where(identityFilter(guildId, channelId, userId));
  }

  async sweepExpired(nowInput?: Date | number): Promise<number> {
    const now = toDate(nowInput);
    const deleted = await db
      .delete(conversationSessions)
      .where(lte(conversationSessions.expiresAt, now))
      .returning({ guildId: conversationSessions.guildId });
    return deleted.length;
  }

  async size(): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationSessions);
    return rows[0]?.count ?? 0;
  }
}

function identityFilter(guildId: string, channelId: string, userId: string) {
  return and(
    eq(conversationSessions.guildId, guildId),
    eq(conversationSessions.channelId, channelId),
    eq(conversationSessions.userId, userId),
  );
}

/** Plain read, no expiry pruning - matches finishTurn/abandonTurn's `Map.get`. */
async function loadRaw(
  executor: Tx | typeof db,
  guildId: string,
  channelId: string,
  userId: string,
): Promise<ConversationSession | undefined> {
  const rows = await executor
    .select()
    .from(conversationSessions)
    .where(identityFilter(guildId, channelId, userId))
    .limit(1);
  return rows[0] ? rowToSession(rows[0]) : undefined;
}

/** Read + delete-if-expired - matches resolveMessage/getSession's `getActiveSession`. */
async function loadActive(
  executor: Tx | typeof db,
  guildId: string,
  channelId: string,
  userId: string,
  now: Date,
): Promise<ConversationSession | undefined> {
  const row = await loadRaw(executor, guildId, channelId, userId);
  if (!row) return undefined;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await executor.delete(conversationSessions).where(identityFilter(guildId, channelId, userId));
    return undefined;
  }
  return row;
}

async function applyWrite(tx: Tx, write: SessionWrite): Promise<void> {
  if (write.kind === "none") return;

  if (write.kind === "delete") {
    const parsed = parseSessionKey(write.id);
    if (!parsed) return;
    await tx.delete(conversationSessions).where(identityFilter(parsed.guildId, parsed.channelId, parsed.userId));
    return;
  }

  const s = write.session;
  const values = {
    guildId: s.guildId,
    channelId: s.channelId,
    userId: s.userId,
    openedByMessageId: s.openedByMessageId,
    lastUserMessageId: s.lastUserMessageId,
    lastBotMessageId: s.lastBotMessageId ?? null,
    lastRequestId: s.lastRequestId ?? null,
    openedAt: s.openedAt,
    updatedAt: s.updatedAt,
    expiresAt: s.expiresAt,
    turns: s.turnCount,
    lockedAt: s.lockedAt ?? null,
  };

  await tx
    .insert(conversationSessions)
    .values(values)
    .onConflictDoUpdate({
      target: [conversationSessions.guildId, conversationSessions.channelId, conversationSessions.userId],
      set: values,
    });
}

/** Serializes concurrent transactions for the same session key. */
async function lockSession(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${id}))`);
}

function rowToSession(row: ConversationSessionRow): ConversationSession {
  return {
    id: sessionKey(row.guildId, row.channelId, row.userId),
    guildId: row.guildId,
    channelId: row.channelId,
    userId: row.userId,
    openedByMessageId: row.openedByMessageId,
    lastUserMessageId: row.lastUserMessageId,
    lastBotMessageId: row.lastBotMessageId ?? undefined,
    lastRequestId: row.lastRequestId ?? undefined,
    openedAt: row.openedAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    turnCount: row.turns,
    lockedAt: row.lockedAt ?? undefined,
  };
}
