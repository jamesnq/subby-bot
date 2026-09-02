import { and, eq, lt } from "drizzle-orm";
import { db } from "../database/db";
import { codeAccessDrafts, type CodeAccessDraftKind, type CodeAccessDraftRow } from "../database/schema";

export const DRAFT_TTL_MS = 15 * 60_000;
export function codeAccessDraftExpiry(now = new Date()): Date { return new Date(now.getTime() + DRAFT_TTL_MS); }
export function isCodeAccessDraftActive(expiresAt: Date, now = new Date()): boolean { return expiresAt.getTime() > now.getTime(); }

export async function upsertCodeAccessDraft(input: {
  guildId: string;
  userId: string;
  kind: CodeAccessDraftKind;
  step: string;
  payload?: Record<string, unknown>;
  messageId?: string | null;
  now?: Date;
}): Promise<CodeAccessDraftRow> {
  const now = input.now ?? new Date();
  const values = {
    guildId: input.guildId,
    userId: input.userId,
    kind: input.kind,
    step: input.step,
    payloadJson: input.payload ?? {},
    messageId: input.messageId ?? null,
    expiresAt: codeAccessDraftExpiry(now),
    updatedAt: now,
  };
  const rows = await db.insert(codeAccessDrafts).values(values).onConflictDoUpdate({
    target: [codeAccessDrafts.guildId, codeAccessDrafts.userId, codeAccessDrafts.kind],
    set: values,
  }).returning();
  return rows[0];
}

export async function getCodeAccessDraft(id: string, now = new Date()): Promise<CodeAccessDraftRow | undefined> {
  const rows = await db.select().from(codeAccessDrafts).where(eq(codeAccessDrafts.id, id)).limit(1);
  const row = rows[0];
  return row && isCodeAccessDraftActive(row.expiresAt, now) ? row : undefined;
}

export async function updateCodeAccessDraft(input: {
  id: string;
  userId: string;
  step?: string;
  payload?: Record<string, unknown>;
  messageId?: string | null;
  now?: Date;
}): Promise<CodeAccessDraftRow | undefined> {
  const now = input.now ?? new Date();
  const values: Partial<typeof codeAccessDrafts.$inferInsert> = {
    updatedAt: now,
    expiresAt: codeAccessDraftExpiry(now),
  };
  if (input.step !== undefined) values.step = input.step;
  if (input.payload !== undefined) values.payloadJson = input.payload;
  if (input.messageId !== undefined) values.messageId = input.messageId;
  const rows = await db.update(codeAccessDrafts).set(values)
    .where(and(eq(codeAccessDrafts.id, input.id), eq(codeAccessDrafts.userId, input.userId))).returning();
  return rows[0];
}

export async function deleteCodeAccessDraft(id: string): Promise<void> {
  await db.delete(codeAccessDrafts).where(eq(codeAccessDrafts.id, id));
}

export async function purgeExpiredCodeAccessDrafts(now = new Date()): Promise<number> {
  const rows = await db.delete(codeAccessDrafts).where(lt(codeAccessDrafts.expiresAt, now)).returning({ id: codeAccessDrafts.id });
  return rows.length;
}
