import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const codeResellerWhitelist = pgTable("code_reseller_whitelist", {
  userId: varchar("user_id", { length: 32 }).primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
