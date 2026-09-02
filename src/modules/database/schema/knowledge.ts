import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { vector } from "./_shared";

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
  (t) => [
    index("knowledge_chunks_doc_idx").on(t.documentId),
    // Both retrieval queries filter on guild_id before anything else.
    index("knowledge_chunks_guild_idx").on(t.guildId),
  ],
);

export const knowledgeEmbeddings = pgTable("knowledge_embeddings", {
  chunkId: uuid("chunk_id")
    .primaryKey()
    .references(() => knowledgeChunks.id, { onDelete: "cascade" }),
  embedding: vector(),
  model: varchar("model", { length: 64 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
