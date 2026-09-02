import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import {
  codeAccessEntitlements,
  type CodeAccessEntitlementRow,
} from "../../database/schema";
import type { CodeAccessVerificationResult } from "../verification";
import {
  CODE_ACCESS_ACCOUNT_NOT_FOUND,
  isAllowedCodeAccessAccount,
  normalizeSteamUsername,
} from "../accounts";
import { fingerprintDevice } from "./fingerprint";
import { getCodeAccessEntitlement } from "./entitlement";
import { isHighConfidenceApproval } from "./review";

export async function upsertVerificationSubmission(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
  purchaseProofUrl: string;
  deviceInfoUrl: string;
  verification: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessEntitlementRow> {
  const userId = input.userId ?? input.discordUserId;
  if (!userId) throw new Error("userId is required");
  return saveVerificationSubmission({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
    purchaseProofUrl: input.purchaseProofUrl,
    deviceInfoUrl: input.deviceInfoUrl,
    verification: input.verification,
    now: input.now,
  });
}

export async function saveVerificationSubmission(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  purchaseProofUrl: string;
  deviceInfoUrl: string;
  verification: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessEntitlementRow> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) {
    throw new Error("Steam username không hợp lệ");
  }
  if (!isAllowedCodeAccessAccount(steamUsername)) {
    throw new Error(CODE_ACCESS_ACCOUNT_NOT_FOUND);
  }

  const now = input.now ?? new Date();
  const device = fingerprintDevice(input.verification);
  const existing = await getCodeAccessEntitlement({
    guildId: input.guildId,
    userId: input.userId,
    steamUsername,
  });
  const deviceMismatch = Boolean(device.hash && existing?.deviceFingerprintHash && existing.deviceFingerprintHash !== device.hash);
  const approved = !deviceMismatch && isHighConfidenceApproval(input.verification, now);
  const status = approved ? "approved" : "pending";
  const subscriptionStart = input.verification.purchaseDate
    ? new Date(`${input.verification.purchaseDate}T00:00:00.000Z`)
    : now;
  const subscriptionEnd = input.verification.expiresAt
    ? new Date(`${input.verification.expiresAt}T00:00:00.000Z`)
    : null;

  const values = {
    guildId: input.guildId,
    userId: input.userId,
    steamUsername,
    status: deviceMismatch ? "rejected" : status,
    subscriptionStart: Number.isFinite(subscriptionStart.getTime()) ? subscriptionStart : now,
    subscriptionEnd: subscriptionEnd && Number.isFinite(subscriptionEnd.getTime()) ? subscriptionEnd : null,
    deviceFingerprintHash: deviceMismatch ? existing?.deviceFingerprintHash : (device.hash || null),
    deviceFingerprintLabel: deviceMismatch ? existing?.deviceFingerprintLabel : (device.hash ? device.label : null),
    purchaseProofUrl: input.purchaseProofUrl,
    deviceInfoUrl: input.deviceInfoUrl,
    verificationJson: publicVerificationMetadata(input.verification, deviceMismatch),
    updatedAt: now,
  };

  const rows = await db
    .insert(codeAccessEntitlements)
    .values(values)
    .onConflictDoUpdate({
      target: [
        codeAccessEntitlements.guildId,
        codeAccessEntitlements.userId,
        codeAccessEntitlements.steamUsername,
      ],
      set: values,
    })
    .returning();

  await writeAudit({
    guildId: input.guildId,
    actorId: input.userId,
    action: "code_access.verify_submitted",
    targetType: "steam_username",
    targetId: steamUsername,
    details: {
      status: values.status,
      confidence: input.verification.confidence,
      deviceMismatch,
      expiresAt: values.subscriptionEnd?.toISOString(),
    },
  });

  return rows[0];
}

export function publicVerificationMetadata(
  result: CodeAccessVerificationResult,
  deviceMismatch: boolean,
): Record<string, unknown> {
  return {
    fullScreenVisible: result.fullScreenVisible,
    dateTimeVisible: result.dateTimeVisible,
    purchaseLooksValid: result.purchaseLooksValid,
    durationMonths: result.durationMonths,
    purchaseDate: result.purchaseDate,
    expiresAt: result.expiresAt,
    confidence: result.confidence,
    reasons: result.reasons,
    deviceMismatch,
    deviceEvidenceFields: Object.entries(result.deviceFingerprint)
      .filter(([key, value]) => key !== "rawVisibleIdentifiers" && typeof value === "string" && value.trim())
      .map(([key]) => key),
    rawVisibleIdentifierCount: result.deviceFingerprint.rawVisibleIdentifiers.length,
  };
}
