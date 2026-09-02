import { eq, lt } from "drizzle-orm";
import { deleteUserAttachment } from "@infra/storage/s3";
import { db } from "../database/db";
import { codeAccessEvidence } from "../database/schema";

const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export async function recordRequestEvidence(input: {
  guildId: string;
  userId: string;
  slotId?: string;
  items: Array<{ kind: string; s3Key: string; sha256: string }>;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  for (const item of input.items) {
    await db.insert(codeAccessEvidence).values({
      guildId: input.guildId,
      userId: input.userId,
      slotId: input.slotId,
      kind: item.kind,
      s3Key: item.s3Key,
      sha256: item.sha256,
      expiresAt: new Date(now.getTime() + REQUEST_RETENTION_MS),
    }).onConflictDoNothing({ target: codeAccessEvidence.s3Key });
  }
}

export async function purgeExpiredRequestEvidence(now = new Date()): Promise<number> {
  const rows = await db.select().from(codeAccessEvidence).where(lt(codeAccessEvidence.expiresAt, now));
  let removed = 0;
  for (const row of rows) {
    try {
      await deleteUserAttachment(row.s3Key);
      await db.delete(codeAccessEvidence).where(eq(codeAccessEvidence.id, row.id));
      removed += 1;
    } catch {
      // Retain the row so a later sweep retries the deletion.
    }
  }
  return removed;
}
