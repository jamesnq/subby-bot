import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const codeAccessEntitlements = pgTable("code_access_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  steamUsername: varchar("steam_username", { length: 128 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  subscriptionStart: timestamp("subscription_start", { withTimezone: true }),
  subscriptionEnd: timestamp("subscription_end", { withTimezone: true }),
  deviceFingerprintHash: varchar("device_fingerprint_hash", { length: 64 }),
  deviceFingerprintLabel: text("device_fingerprint_label"),
  purchaseProofUrl: text("purchase_proof_url"),
  deviceInfoUrl: text("device_info_url"),
  verificationJson: jsonb("verification_json").$type<Record<string, unknown>>(),
  reviewedBy: varchar("reviewed_by", { length: 32 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("code_access_user_steam_idx").on(t.guildId, t.userId, t.steamUsername),
  index("code_access_status_idx").on(t.guildId, t.status, t.updatedAt),
  index("code_access_steam_idx").on(t.guildId, t.steamUsername),
]);

export type CodeAccessEntitlementRow = typeof codeAccessEntitlements.$inferSelect;
export type NewCodeAccessEntitlementRow = typeof codeAccessEntitlements.$inferInsert;

export const steamCodeMailCache = pgTable("steam_code_mail_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  gmailMessageId: varchar("gmail_message_id", { length: 128 }).notNull(),
  steamUsername: varchar("steam_username", { length: 128 }).notNull(),
  accountLabel: varchar("account_label", { length: 128 }).notNull(),
  code: varchar("code", { length: 16 }).notNull(),
  sender: text("sender"),
  subject: text("subject"),
  bodyPreview: text("body_preview"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("steam_code_mail_message_idx").on(t.gmailMessageId),
  index("steam_code_mail_account_received_idx").on(t.steamUsername, t.receivedAt),
]);

export type SteamCodeMailCacheRow = typeof steamCodeMailCache.$inferSelect;
export type NewSteamCodeMailCacheRow = typeof steamCodeMailCache.$inferInsert;
