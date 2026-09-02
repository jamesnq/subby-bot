import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type CodeAccessDeviceType = "pc" | "handheld";
export type CodeAccessSlotStatus = "approved" | "suspended" | "revoked" | "expired";
export type CodeAccessDraftKind = "signup" | "request";
export type CodeAccessEscalationStatus = "open" | "approved" | "rejected" | "expired";

export const codeAccessDevices = pgTable("code_access_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  fingerprintHash: varchar("fingerprint_hash", { length: 64 }).notNull(),
  deviceJson: jsonb("device_json").$type<Record<string, unknown>>().notNull(),
  deviceType: varchar("device_type", { length: 16 }).$type<CodeAccessDeviceType>().notNull().default("pc"),
  osEdition: varchar("os_edition", { length: 64 }),
  osVersionLocked: varchar("os_version_locked", { length: 32 }),
  osBuildAtSignup: varchar("os_build_at_signup", { length: 32 }),
  deviceInfoS3Key: text("device_info_s3_key"),
  deviceInfoSha256: varchar("device_info_sha256", { length: 64 }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("code_access_devices_fingerprint_idx").on(t.fingerprintHash),
  index("code_access_devices_user_idx").on(t.guildId, t.userId),
  index("code_access_devices_product_expr_idx").on(sql`lower(regexp_replace(coalesce(${t.deviceJson}->>'productId', ''), '[^a-zA-Z0-9]', '', 'g'))`),
  index("code_access_devices_name_expr_idx").on(sql`lower(regexp_replace(coalesce(${t.deviceJson}->>'deviceName', ''), '[^a-zA-Z0-9]', '', 'g'))`),
  index("code_access_devices_board_expr_idx").on(sql`lower(regexp_replace(coalesce(${t.deviceJson}->>'motherboard', ''), '[^a-zA-Z0-9]', '', 'g'))`),
  index("code_access_devices_cpu_expr_idx").on(sql`lower(regexp_replace(coalesce(${t.deviceJson}->>'processor', ''), '[^a-zA-Z0-9]', '', 'g'))`),
]);

export const codeAccessSlots = pgTable("code_access_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  discordUsername: varchar("discord_username", { length: 64 }).notNull(),
  steamUsername: varchar("steam_username", { length: 128 }).notNull(),
  deviceId: uuid("device_id").notNull().references(() => codeAccessDevices.id),
  status: varchar("status", { length: 16 }).$type<CodeAccessSlotStatus>().notNull().default("approved"),
  suspendReason: varchar("suspend_reason", { length: 32 }),
  orderCode: varchar("order_code", { length: 64 }),
  orderPlacedAt: timestamp("order_placed_at", { withTimezone: true }),
  orderSource: varchar("order_source", { length: 32 }),
  orderTotalText: varchar("order_total_text", { length: 64 }),
  productName: text("product_name"),
  planKind: varchar("plan_kind", { length: 16 }).notNull(),
  planUnits: integer("plan_units"),
  subscriptionStart: timestamp("subscription_start", { withTimezone: true }).notNull(),
  subscriptionEnd: timestamp("subscription_end", { withTimezone: true }),
  purchaseProofS3Key: text("purchase_proof_s3_key"),
  purchaseProofSha256: varchar("purchase_proof_sha256", { length: 64 }),
  ocrJson: jsonb("ocr_json").$type<Record<string, unknown>>(),
  ocrConfidence: real("ocr_confidence"),
  lastCodeIssuedAt: timestamp("last_code_issued_at", { withTimezone: true }),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("code_access_slots_device_idx").on(t.deviceId),
  uniqueIndex("code_access_slots_order_idx").on(t.guildId, t.orderCode).where(sql`${t.orderCode} is not null`),
  index("code_access_slots_user_steam_idx").on(t.guildId, t.userId, t.steamUsername),
  index("code_access_slots_purchase_sha_idx").on(t.purchaseProofSha256),
  index("code_access_slots_subscription_end_idx").on(t.subscriptionEnd),
]);

export const codeAccessDrafts = pgTable("code_access_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  kind: varchar("kind", { length: 16 }).$type<CodeAccessDraftKind>().notNull(),
  step: varchar("step", { length: 32 }).notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  messageId: varchar("message_id", { length: 32 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("code_access_drafts_user_kind_idx").on(t.guildId, t.userId, t.kind),
  index("code_access_drafts_expiry_idx").on(t.expiresAt),
]);

export const codeAccessOcrCache = pgTable("code_access_ocr_cache", {
  sha256Key: varchar("sha256_key", { length: 64 }).primaryKey(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const codeAccessEscalations = pgTable("code_access_escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  slotId: uuid("slot_id").references(() => codeAccessSlots.id, { onDelete: "set null" }),
  draftId: uuid("draft_id").references(() => codeAccessDrafts.id, { onDelete: "set null" }),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
  evidenceKeys: text("evidence_keys").array().notNull().default(sql`'{}'::text[]`),
  status: varchar("status", { length: 16 }).$type<CodeAccessEscalationStatus>().notNull().default("open"),
  adminMsgId: varchar("admin_msg_id", { length: 32 }),
  decidedBy: varchar("decided_by", { length: 32 }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("code_access_escalations_status_idx").on(t.guildId, t.status, t.createdAt)]);

export const codeAccessEvidence = pgTable("code_access_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 32 }).notNull(),
  slotId: uuid("slot_id").references(() => codeAccessSlots.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 16 }).notNull(),
  s3Key: text("s3_key").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("code_access_evidence_s3_key_idx").on(t.s3Key),
  index("code_access_evidence_expiry_idx").on(t.expiresAt),
]);

export type CodeAccessDeviceRow = typeof codeAccessDevices.$inferSelect;
export type CodeAccessSlotRow = typeof codeAccessSlots.$inferSelect;
export type CodeAccessDraftRow = typeof codeAccessDrafts.$inferSelect;
export type CodeAccessOcrCacheRow = typeof codeAccessOcrCache.$inferSelect;
export type CodeAccessEscalationRow = typeof codeAccessEscalations.$inferSelect;
export type CodeAccessEvidenceRow = typeof codeAccessEvidence.$inferSelect;
export type CodeAccessEntitlementRow = CodeAccessSlotRow;

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
