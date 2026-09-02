import { and, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import { codeAccessDevices, codeAccessSlots, type CodeAccessSlotRow } from "../../database/schema";
import type { CodeAccessOcrResult } from "../ocr";
import { normalizeSteamUsername } from "../accounts";
import { closeOpenEscalationsForDraft, createEscalation, getOpenEscalation } from "../escalations";
import { decideConfidence, type FraudFlag } from "./decisions";
import { detectSignupFraud } from "./fraud";
import { fingerprintDevice } from "./fingerprint";
import { calculateSubscription } from "./subscriptions";
import { evidenceFlags, missingSignupFields } from "./validation";

export type SignupEvidence = {
  purchaseProofS3Key: string;
  purchaseProofSha256: string;
  deviceInfoS3Key: string;
  deviceInfoSha256: string;
};

export type SignupResult =
  | { kind: "approved"; slot: CodeAccessSlotRow; auditReviewRecommended: boolean }
  | { kind: "escalated"; escalationId: string; flags: FraudFlag[] }
  | { kind: "missing_fields"; fields: string[] }
  | { kind: "invalid_evidence"; flags: string[] };

export async function finalizeSignup(input: {
  guildId: string;
  userId: string;
  discordUsername: string;
  steamUsername: string;
  draftId: string;
  ocr: CodeAccessOcrResult;
  evidence: SignupEvidence;
  now?: Date;
  adminOverrideId?: string;
  channelId?: string;
}): Promise<SignupResult> {
  const now = input.now ?? new Date();
  const missing = missingSignupFields(input.ocr);
  if (missing.length) return { kind: "missing_fields", fields: missing };
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) return { kind: "missing_fields", fields: ["steam_username"] };
  const fingerprint = fingerprintDevice(input.ocr.device);
  const fraudFlags = await detectSignupFraud({
    guildId: input.guildId,
    userId: input.userId,
    purchaseProofSha256: input.evidence.purchaseProofSha256,
    orderCode: input.ocr.order?.orderCode ?? null,
    fingerprintHash: fingerprint.hash,
    device: input.ocr.device,
  });
  const decision = decideConfidence(input.ocr.confidence, fraudFlags);
  if (decision === "escalate" && !input.adminOverrideId) {
    const existingEscalation = await getOpenEscalation({ guildId: input.guildId, userId: input.userId });
    if (existingEscalation?.draftId === input.draftId) {
      return { kind: "escalated", escalationId: existingEscalation.id, flags: fraudFlags };
    }
    const escalation = await createEscalation({
      guildId: input.guildId,
      userId: input.userId,
      kind: fraudFlags.length ? "fraud_flag" : "signup_low_conf",
      draftId: input.draftId,
      payload: { ocr: input.ocr, fraudFlags, steamUsername, discordUsername: input.discordUsername, evidence: input.evidence, channelId: input.channelId },
      evidenceKeys: [input.evidence.purchaseProofS3Key, input.evidence.deviceInfoS3Key],
      now,
    });
    return { kind: "escalated", escalationId: escalation.id, flags: fraudFlags };
  }
  const invalidFlags = evidenceFlags(input.ocr, false, now).filter((flag) => ["cropped", "stale_shot", "edited", "unreadable"].includes(flag));
  if (invalidFlags.length && !input.adminOverrideId) return { kind: "invalid_evidence", flags: invalidFlags };

  const order = input.ocr.order!;
  const subscription = calculateSubscription({
    planKind: order.planKind!,
    planUnits: order.planUnits,
    orderPlacedAt: order.orderPlacedAt,
    now,
  });
  const slot = await db.transaction(async (tx): Promise<CodeAccessSlotRow> => {
    const rebindRows = await tx.select().from(codeAccessSlots).where(and(
      eq(codeAccessSlots.guildId, input.guildId), eq(codeAccessSlots.userId, input.userId),
      eq(codeAccessSlots.steamUsername, steamUsername), eq(codeAccessSlots.suspendReason, "rebind_required"),
    )).limit(1);
    const deviceRows = await tx.insert(codeAccessDevices).values({
      guildId: input.guildId, userId: input.userId, fingerprintHash: fingerprint.hash,
      deviceJson: input.ocr.device, deviceType: "pc", osEdition: input.ocr.device.osEdition,
      osVersionLocked: input.ocr.device.osVersion, osBuildAtSignup: input.ocr.device.osBuild,
      deviceInfoS3Key: input.evidence.deviceInfoS3Key, deviceInfoSha256: input.evidence.deviceInfoSha256,
      lastVerifiedAt: now,
    }).returning();
    const slotValues = {
      guildId: input.guildId, userId: input.userId, discordUsername: input.discordUsername.slice(0, 64),
      steamUsername, deviceId: deviceRows[0].id, status: "approved" as const, suspendReason: null,
      orderCode: order.orderCode, orderPlacedAt: parseDate(order.orderPlacedAt), orderSource: order.orderSource,
      orderTotalText: order.orderTotalText, productName: order.productName, planKind: order.planKind!,
      planUnits: order.planKind === "lifetime" ? null : order.planUnits ?? 1,
      subscriptionStart: subscription.start, subscriptionEnd: subscription.end,
      purchaseProofS3Key: input.evidence.purchaseProofS3Key, purchaseProofSha256: input.evidence.purchaseProofSha256,
      ocrJson: input.ocr, ocrConfidence: input.ocr.confidence, onboardedAt: now, updatedAt: now,
    };
    if (rebindRows[0]) {
      const updated = await tx.update(codeAccessSlots).set(slotValues).where(eq(codeAccessSlots.id, rebindRows[0].id)).returning();
      await tx.delete(codeAccessDevices).where(eq(codeAccessDevices.id, rebindRows[0].deviceId));
      return updated[0];
    }
    const inserted = await tx.insert(codeAccessSlots).values(slotValues).returning();
    return inserted[0];
  });
  if (!input.adminOverrideId) await closeOpenEscalationsForDraft(input.draftId);
  await writeAudit({
    guildId: input.guildId,
    actorId: input.adminOverrideId ?? input.userId,
    action: "code_access.signup",
    targetType: "code_access_slot",
    targetId: slot.id,
    details: { confidence: input.ocr.confidence, decision, planKind: order.planKind, adminOverride: Boolean(input.adminOverrideId) },
  });
  return { kind: "approved", slot, auditReviewRecommended: decision === "approve_with_audit" };
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}
