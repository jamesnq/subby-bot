import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
export const botCodeOrders = pgTable("bot_code_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderCode: bigint("order_code",{mode:"number"}).notNull().unique(),
  userId: varchar("user_id",{length:32}).notNull(),
  account: varchar("account",{length:128}).notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("creating"),
  paymentDetails: jsonb("payment_details"),
  checkoutUrl: text("checkout_url"), providerLinkId: text("provider_link_id"),
  codeDigest: text("code_digest"),
  gmailMessageId: text("gmail_message_id"), discordMessageId: text("discord_message_id"),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
  paidAt: timestamp("paid_at",{withTimezone:true}),fulfilledAt: timestamp("fulfilled_at",{withTimezone:true}),
  lastCheckedAt: timestamp("last_checked_at",{withTimezone:true}),lastError: text("last_error"),
},t=>[
  check("bot_code_price",sql`${t.amount}=100000`),
  check("bot_code_status",sql`${t.status} IN ('creating','pending','paid','fulfilled','cancelled','expired')`),
  uniqueIndex("bot_code_active_user_account").on(t.userId,t.account).where(sql`${t.status} IN ('creating','pending','paid')`),
  uniqueIndex("bot_code_delivery_once").on(t.userId,t.account,t.gmailMessageId).where(sql`${t.status}='fulfilled'`),
  uniqueIndex("bot_code_value_once").on(t.userId,t.account,t.codeDigest).where(sql`${t.status}='fulfilled'`),
  index("bot_code_poll").on(t.status,t.lastCheckedAt),
]);
