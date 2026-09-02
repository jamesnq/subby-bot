import { date, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 128 }).notNull(),
    hitAt: timestamp("hit_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_hits_key_hit_at_idx").on(t.key, t.hitAt)],
);

export const dailyLimitCounts = pgTable(
  "daily_limit_counts",
  {
    scopeKey: varchar("scope_key", { length: 128 }).notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("daily_limit_counts_scope_day_idx").on(t.scopeKey, t.day)],
);

export const conversationSessions = pgTable(
  "conversation_sessions",
  {
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 32 }).notNull(),
    openedByMessageId: varchar("opened_by_message_id", { length: 32 }).notNull(),
    lastUserMessageId: varchar("last_user_message_id", { length: 32 }).notNull(),
    lastBotMessageId: varchar("last_bot_message_id", { length: 32 }),
    lastRequestId: varchar("last_request_id", { length: 64 }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    turns: integer("turns").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set to the moment the turn started, not a precomputed expiry - the
    // store compares (now - lockedAt) against its own lockTtlMs, matching
    // MemoryConversationSessionStore exactly.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_sessions_identity_idx").on(t.guildId, t.channelId, t.userId),
    index("conversation_sessions_expires_idx").on(t.expiresAt),
  ],
);

export type ConversationSessionRow = typeof conversationSessions.$inferSelect;
