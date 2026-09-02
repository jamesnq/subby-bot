import { db } from "./db";
import { auditLogs } from "./schema";
import { logger } from "@shared/logger";

export type AuditEntry = {
  requestId?: string;
  guildId: string;
  actorId: string;
  actorType?: "user" | "bot" | "system";
  action: string;
  targetType?: string;
  targetId?: string;
  status?: "ok" | "failed" | "denied";
  details?: Record<string, unknown>;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      requestId: entry.requestId,
      guildId: entry.guildId,
      actorId: entry.actorId,
      actorType: entry.actorType ?? "user",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      status: entry.status ?? "ok",
      details: entry.details,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}

