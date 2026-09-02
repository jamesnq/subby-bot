import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const approvalRequests = pgTable(
  "approval_requests",
  {
    requestId: varchar("request_id", { length: 64 }).primaryKey(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    requesterId: varchar("requester_id", { length: 32 }).notNull(),
    approverId: varchar("approver_id", { length: 32 }),
    risk: varchar("risk", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    planJson: jsonb("plan_json").$type<Record<string, unknown>[]>().notNull(),
    planHash: varchar("plan_hash", { length: 64 }).notNull(),
    previewMessageId: varchar("preview_message_id", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("approval_guild_status_idx").on(t.guildId, t.status)],
);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    stepIndex: integer("step_index").notNull(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    requesterId: varchar("requester_id", { length: 32 }).notNull(),
    toolName: varchar("tool_name", { length: 64 }).notNull(),
    risk: varchar("risk", { length: 16 }).notNull(),
    argsJson: jsonb("args_json").$type<Record<string, unknown>>().notNull(),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    error: text("error"),
    status: varchar("status", { length: 16 }).notNull().default("success"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tool_executions_idem_idx").on(t.idempotencyKey),
    index("tool_exec_request_idx").on(t.requestId),
  ],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 32 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_thread_idx").on(t.guildId, t.channelId, t.userId, t.createdAt)],
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    llmCalls: integer("llm_calls").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.day] })],
);
