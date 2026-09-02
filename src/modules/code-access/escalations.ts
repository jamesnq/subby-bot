import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../database/db";
import {
  codeAccessEscalations,
  type CodeAccessEscalationRow,
  type CodeAccessEscalationStatus,
} from "../database/schema";

export const ESCALATION_TTL_MS = 48 * 60 * 60 * 1_000;
export function escalationExpiry(now = new Date()): Date { return new Date(now.getTime() + ESCALATION_TTL_MS); }
export function isEscalationExpired(expiresAt: Date, now = new Date()): boolean { return expiresAt.getTime() <= now.getTime(); }

export async function createEscalation(input: {
  guildId: string;
  userId: string;
  kind: "signup_low_conf" | "os_mismatch" | "request_low_conf" | "fraud_flag";
  slotId?: string | null;
  draftId?: string | null;
  payload: Record<string, unknown>;
  evidenceKeys: string[];
  now?: Date;
}): Promise<CodeAccessEscalationRow> {
  const now = input.now ?? new Date();
  const rows = await db.insert(codeAccessEscalations).values({
    guildId: input.guildId,
    userId: input.userId,
    kind: input.kind,
    slotId: input.slotId ?? null,
    draftId: input.draftId ?? null,
    payloadJson: input.payload,
    evidenceKeys: input.evidenceKeys,
    expiresAt: escalationExpiry(now),
  }).returning();
  return rows[0];
}

export async function getEscalation(id: string): Promise<CodeAccessEscalationRow | undefined> {
  const rows = await db.select().from(codeAccessEscalations).where(eq(codeAccessEscalations.id, id)).limit(1);
  return rows[0];
}

export async function getOpenEscalation(input: { guildId: string; userId: string }): Promise<CodeAccessEscalationRow | undefined> {
  const rows = await db.select().from(codeAccessEscalations).where(and(
    eq(codeAccessEscalations.guildId, input.guildId),
    eq(codeAccessEscalations.userId, input.userId),
    eq(codeAccessEscalations.status, "open"),
  )).orderBy(desc(codeAccessEscalations.createdAt)).limit(1);
  return rows[0];
}

export async function listOpenEscalations(guildId: string, limit = 10): Promise<CodeAccessEscalationRow[]> {
  return db.select().from(codeAccessEscalations).where(and(
    eq(codeAccessEscalations.guildId, guildId),
    eq(codeAccessEscalations.status, "open"),
  )).orderBy(desc(codeAccessEscalations.createdAt)).limit(limit);
}

export async function decideEscalation(input: { id: string; adminId: string; status: Extract<CodeAccessEscalationStatus, "approved" | "rejected"> }): Promise<CodeAccessEscalationRow | undefined> {
  const rows = await db.update(codeAccessEscalations).set({
    status: input.status,
    decidedBy: input.adminId,
    decidedAt: new Date(),
  }).where(and(eq(codeAccessEscalations.id, input.id), eq(codeAccessEscalations.status, "open"))).returning();
  return rows[0];
}

export async function closeOpenEscalationsForDraft(draftId: string): Promise<number> {
  const rows = await db.update(codeAccessEscalations).set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(codeAccessEscalations.draftId, draftId), eq(codeAccessEscalations.status, "open")))
    .returning({ id: codeAccessEscalations.id });
  return rows.length;
}

export async function expireEscalations(now = new Date()): Promise<CodeAccessEscalationRow[]> {
  const rows = await db.update(codeAccessEscalations).set({ status: "expired", decidedAt: now })
    .where(and(eq(codeAccessEscalations.status, "open"), lt(codeAccessEscalations.expiresAt, now)))
    .returning();
  return rows;
}

export async function setEscalationMessageId(id: string, adminMsgId: string): Promise<void> {
  await db.update(codeAccessEscalations).set({ adminMsgId }).where(eq(codeAccessEscalations.id, id));
}

export async function updateEscalationPayload(id: string, payload: Record<string, unknown>): Promise<void> {
  await db.update(codeAccessEscalations).set({ payloadJson: payload }).where(eq(codeAccessEscalations.id, id));
}

export async function getRecentApprovedRequestEscalation(slotId: string, userId: string): Promise<CodeAccessEscalationRow | undefined> {
  const rows = await db.select().from(codeAccessEscalations).where(and(
    eq(codeAccessEscalations.slotId, slotId),
    eq(codeAccessEscalations.userId, userId),
    eq(codeAccessEscalations.kind, "request_low_conf"),
    eq(codeAccessEscalations.status, "approved"),
    gt(codeAccessEscalations.expiresAt, new Date()),
  )).orderBy(desc(codeAccessEscalations.decidedAt)).limit(1);
  return rows[0];
}

export async function consumeApprovedRequestEscalation(id: string): Promise<void> {
  await db.update(codeAccessEscalations).set({ status: "expired" }).where(and(
    eq(codeAccessEscalations.id, id), eq(codeAccessEscalations.status, "approved"),
  ));
}
