import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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
export type NewGuildSettingsRow = typeof guildSettings.$inferInsert;

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
