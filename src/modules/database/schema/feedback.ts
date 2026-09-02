import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: varchar("request_id", { length: 64 }).notNull(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  rating: varchar("rating", { length: 8 }).notNull(),
  comment: text("comment"),
  reviewStatus: varchar("review_status", { length: 16 }).notNull().default("pending"),
  reviewedBy: varchar("reviewed_by", { length: 32 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  cacheInvalidated: boolean("cache_invalidated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("feedback_guild_status_idx").on(t.guildId, t.reviewStatus, t.createdAt),
  index("feedback_request_idx").on(t.requestId),
  uniqueIndex("feedback_request_user_idx").on(t.requestId, t.userId),
]);

export const aiResponseSnapshots = pgTable("ai_response_snapshots", {
  requestId: varchar("request_id", { length: 64 }).primaryKey(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  channelId: varchar("channel_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  intent: varchar("intent", { length: 16 }),
  queryHash: varchar("query_hash", { length: 64 }),
  roleScopeHash: varchar("role_scope_hash", { length: 64 }),
  cached: boolean("cached").notNull().default(false),
  retrievedChunks: jsonb("retrieved_chunks").$type<
    { chunkId: string; documentId: string; title: string; sourceType: string; score: number }[]
  >(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_snapshots_guild_created_idx").on(t.guildId, t.createdAt),
  index("ai_snapshots_query_idx").on(t.guildId, t.queryHash, t.roleScopeHash),
]);
