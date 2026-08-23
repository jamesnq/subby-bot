import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const VECTOR_DIMS = Number(process.env.VECTOR_DIMS ?? "1536");

const vector = () =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${VECTOR_DIMS})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
  })();

export const guildSettings = pgTable("guild_settings", {
  guildId: varchar("guild_id", { length: 32 }).primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  allChannels: boolean("all_channels").notNull().default(false),
  destructiveEnabled: boolean("destructive_enabled").notNull().default(true),
  allowMentions: boolean("allow_mentions").notNull().default(false),
  modRoleId: varchar("mod_role_id", { length: 32 }),
  modLogChannelId: varchar("mod_log_channel_id", { length: 32 }),
  supportCategoryId: varchar("support_category_id", { length: 32 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GuildSettingsRow = typeof guildSettings.$inferSelect;

export const guildAiChannels = pgTable(
  "guild_ai_channels",
  {
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    addedBy: varchar("added_by", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.channelId] })],
);

export const guildAllowedRoles = pgTable(
  "guild_allowed_roles",
  {
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    roleId: varchar("role_id", { length: 32 }).notNull(),
    addedBy: varchar("added_by", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.roleId] })],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: varchar("request_id", { length: 64 }),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    actorId: varchar("actor_id", { length: 32 }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull().default("user"),
    action: varchar("action", { length: 128 }).notNull(),
    targetType: varchar("target_type", { length: 64 }),
    targetId: varchar("target_id", { length: 64 }),
    status: varchar("status", { length: 16 }).notNull().default("ok"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_guild_created_idx").on(t.guildId, t.createdAt)],
);

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

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    title: text("title").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull().default("manual"),
    visibility: varchar("visibility", { length: 16 }).notNull().default("public"),
    allowedRoleIds: text("allowed_role_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    version: integer("version").notNull().default(1),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_docs_guild_idx").on(t.guildId)],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentSearch: text("content_search").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_chunks_doc_idx").on(t.documentId)],
);

export const knowledgeEmbeddings = pgTable("knowledge_embeddings", {
  chunkId: uuid("chunk_id")
    .primaryKey()
    .references(() => knowledgeChunks.id, { onDelete: "cascade" }),
  embedding: vector(),
  model: varchar("model", { length: 64 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    channelId: varchar("channel_id", { length: 32 }).notNull(),
    createdBy: varchar("created_by", { length: 32 }).notNull(),
    jobType: varchar("job_type", { length: 32 }).notNull().default("send_message"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scheduled_jobs_due_idx").on(t.status, t.runAt)],
);

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

export const faqCache = pgTable(
  "faq_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: varchar("guild_id", { length: 32 }).notNull(),
    queryHash: varchar("query_hash", { length: 64 }).notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    citations: jsonb("citations").$type<string[]>(),
    roleScopeHash: varchar("role_scope_hash", { length: 64 }).notNull().default(""),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("faq_cache_guild_query_idx").on(t.guildId, t.queryHash, t.roleScopeHash),
    index("faq_cache_expiry_idx").on(t.expiresAt),
  ],
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

