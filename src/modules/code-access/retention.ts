import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { deleteUserAttachment } from "@infra/storage/s3";
import { config } from "@config";
import { db } from "../database/db";
import { codeAccessDevices, codeAccessEscalations, codeAccessSlots, type CodeAccessEscalationRow } from "../database/schema";
import { purgeExpiredCodeAccessDrafts } from "./drafts";
import { expireEscalations } from "./escalations";
import { purgeExpiredOcrCache } from "./ocr";
import { purgeExpiredRequestEvidence } from "./evidence";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1_000;

export async function sweepCodeAccessData(now = new Date()): Promise<{ drafts: number; ocr: number; escalations: number; slots: number; expiredEscalations: CodeAccessEscalationRow[]; images: number }> {
  const [drafts, ocr, expiredEscalations, slots] = await Promise.all([
    purgeExpiredCodeAccessDrafts(now), purgeExpiredOcrCache(now), expireEscalations(now), expireSlots(now),
  ]);
  const escalations = expiredEscalations.length;
  if (!config.S3_ENABLED) return { drafts, ocr, escalations, slots, expiredEscalations, images: 0 };
  const [requestImages, steamImages, signupImages] = await Promise.all([
    purgeExpiredRequestEvidence(now), sweepSteamEvidence(now), sweepSignupEvidence(now),
  ]);
  return { drafts, ocr, escalations, slots, expiredEscalations, images: requestImages + steamImages + signupImages };
}

async function expireSlots(now: Date): Promise<number> {
  const rows = await db.update(codeAccessSlots).set({ status: "expired", updatedAt: now }).where(and(
    eq(codeAccessSlots.status, "approved"), lt(codeAccessSlots.subscriptionEnd, now),
  )).returning({ id: codeAccessSlots.id });
  return rows.length;
}

async function sweepSteamEvidence(now: Date): Promise<number> {
  const rows = await db.select().from(codeAccessEscalations).where(and(
    lt(codeAccessEscalations.createdAt, new Date(now.getTime() - THIRTY_DAYS_MS)),
    sql`cardinality(${codeAccessEscalations.evidenceKeys}) > 0`,
  ));
  let removed = 0;
  for (const row of rows) {
    const results = await Promise.allSettled(row.evidenceKeys.map(deleteUserAttachment));
    removed += results.filter((item) => item.status === "fulfilled").length;
    if (results.every((item) => item.status === "fulfilled")) {
      await db.update(codeAccessEscalations).set({ evidenceKeys: [] }).where(eq(codeAccessEscalations.id, row.id));
    }
  }
  return removed;
}

async function sweepSignupEvidence(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - NINETY_DAYS_MS);
  const rows = await db.select({ slot: codeAccessSlots, device: codeAccessDevices }).from(codeAccessSlots)
    .innerJoin(codeAccessDevices, eq(codeAccessSlots.deviceId, codeAccessDevices.id))
    .where(and(lt(codeAccessSlots.subscriptionEnd, cutoff), isNotNull(codeAccessSlots.purchaseProofS3Key)));
  let removed = 0;
  for (const { slot, device } of rows) {
    const keys = [slot.purchaseProofS3Key, device.deviceInfoS3Key].filter((key): key is string => Boolean(key));
    const results = await Promise.allSettled(keys.map(deleteUserAttachment));
    removed += results.filter((item) => item.status === "fulfilled").length;
    if (results.every((item) => item.status === "fulfilled")) {
      await Promise.all([
        db.update(codeAccessSlots).set({ purchaseProofS3Key: null }).where(eq(codeAccessSlots.id, slot.id)),
        db.update(codeAccessDevices).set({ deviceInfoS3Key: null }).where(eq(codeAccessDevices.id, device.id)),
      ]);
    }
  }
  return removed;
}
