import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../database/db";
import { writeAudit } from "../database/audit";
import {
  codeAccessEntitlements,
  type CodeAccessEntitlementRow,
} from "../database/schema";
import {
  type CodeAccessVerificationResult,
} from "./verification";

export type CodeAccessDecision =
  | { ok: true; entitlement: CodeAccessEntitlementRow; message: string }
  | { ok: false; entitlement?: CodeAccessEntitlementRow; reason: string };

export type CodeAccessRequestedCapability =
  | "manual_code_access"
  | "gmail_access"
  | "two_factor_code"
  | "code_retrieval";

const UNSUPPORTED_SECRET_CAPABILITIES = new Set<CodeAccessRequestedCapability>([
  "gmail_access",
  "two_factor_code",
  "code_retrieval",
]);

export function normalizeSteamUsername(input: string): string {
  const fromUrl = extractSteamIdentifier(input);
  return (fromUrl ?? input)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^@+/, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 128);
}

export function fingerprintDevice(result: Pick<CodeAccessVerificationResult, "deviceFingerprint">): {
  hash: string;
  label: string;
} {
  const fingerprint = result.deviceFingerprint;
  const parts = [
    fingerprint.deviceName,
    fingerprint.platform,
    fingerprint.model,
    fingerprint.osVersion,
    fingerprint.serialNumber,
    fingerprint.imei,
    fingerprint.meid,
    fingerprint.androidId,
    fingerprint.udid,
    fingerprint.hardwareId,
    ...fingerprint.rawVisibleIdentifiers,
  ]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const canonical = parts.join("|") || "unknown-device";
  if (canonical === "unknown-device") {
    return { hash: "", label: "unknown-device" };
  }
  return {
    hash: crypto.createHash("sha256").update(canonical).digest("hex"),
    label: parts.slice(0, 4).join(" / ").slice(0, 240) || "unknown-device",
  };
}

export function sameDeviceFingerprint(
  entitlement: Pick<CodeAccessEntitlementRow, "deviceFingerprintHash">,
  verification: CodeAccessVerificationResult,
): boolean {
  if (!entitlement.deviceFingerprintHash) return true;
  return entitlement.deviceFingerprintHash === fingerprintDevice(verification).hash;
}

export async function getEntitlement(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const userId = input.userId ?? input.discordUserId;
  if (!userId) throw new Error("userId is required");
  return getCodeAccessEntitlement({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
  });
}

export async function getCodeAccessEntitlement(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) return undefined;
  const rows = await db
    .select()
    .from(codeAccessEntitlements)
    .where(
      and(
        eq(codeAccessEntitlements.guildId, input.guildId),
        eq(codeAccessEntitlements.userId, input.userId),
        eq(codeAccessEntitlements.steamUsername, steamUsername),
      ),
    )
    .orderBy(desc(codeAccessEntitlements.updatedAt))
    .limit(1);
  return rows[0];
}

export async function requestAccessDecision(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
  requestedCapability?: CodeAccessRequestedCapability;
  deviceVerification?: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessDecision> {
  if (UNSUPPORTED_SECRET_CAPABILITIES.has(input.requestedCapability ?? "manual_code_access")) {
    return {
      ok: false,
      reason: "This service does not retrieve Gmail, MFA/2FA, OTP, login codes, passwords, tokens, or credentials.",
    };
  }

  const userId = input.userId ?? input.discordUserId;
  if (!userId) return { ok: false, reason: "Discord user id is required." };
  return requestCodeAccess({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
    deviceVerification: input.deviceVerification,
    now: input.now,
  });
}

export async function requestCodeAccess(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  deviceVerification?: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessDecision> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) {
    return { ok: false, reason: "Username Steam không hợp lệ." };
  }

  const entitlement = await getCodeAccessEntitlement({
    guildId: input.guildId,
    userId: input.userId,
    steamUsername,
  });
  if (!entitlement) {
    return {
      ok: false,
      reason: "Bạn chưa verify quyền sử dụng. Dùng `/code verify` với ảnh mua hàng và ảnh thông tin máy tính fullscreen rõ ngày giờ.",
    };
  }
  if (entitlement.status !== "approved") {
    return {
      ok: false,
      entitlement,
      reason: `Quyền sử dụng đang ở trạng thái \`${entitlement.status}\`, chưa thể xử lý yêu cầu.`,
    };
  }

  const now = input.now ?? new Date();
  if (!entitlement.subscriptionEnd || entitlement.subscriptionEnd.getTime() <= now.getTime()) {
    return {
      ok: false,
      entitlement,
      reason: "Gói sử dụng đã hết hạn. Vui lòng gia hạn và verify lại bằng chứng mua hàng mới.",
    };
  }

  if (input.deviceVerification && !sameDeviceFingerprint(entitlement, input.deviceVerification)) {
    return {
      ok: false,
      entitlement,
      reason: "Thông tin máy tính không khớp với máy đã kích hoạt ban đầu. Mỗi user chỉ được dùng một máy.",
    };
  }

  return {
    ok: true,
    entitlement,
    message: "Bạn đủ điều kiện sử dụng. Vì lý do bảo mật, bot không tự động phát mã đăng nhập; admin sẽ xử lý thủ công qua kênh an toàn.",
  };
}

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

export async function adminReviewEntitlement(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
  decision?: "approve" | "deny" | "revoke";
  status?: "approved" | "rejected" | "revoked";
  reviewerId: string;
  subscriptionEnd?: Date;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const userId = input.userId ?? input.discordUserId;
  if (!userId) throw new Error("userId is required");

  const status = input.status ?? reviewDecisionToStatus(input.decision ?? "deny");
  return adminReviewCodeAccess({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
    status,
    reviewerId: input.reviewerId,
    subscriptionEnd: input.subscriptionEnd,
  });
}

export async function adminReviewCodeAccess(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  status: "approved" | "rejected" | "revoked";
  reviewerId: string;
  subscriptionEnd?: Date;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  const rows = await db
    .update(codeAccessEntitlements)
    .set({
      status: input.status,
      subscriptionEnd: input.subscriptionEnd,
      reviewedBy: input.reviewerId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(codeAccessEntitlements.guildId, input.guildId),
        eq(codeAccessEntitlements.userId, input.userId),
        eq(codeAccessEntitlements.steamUsername, steamUsername),
      ),
    )
    .returning();

  await writeAudit({
    guildId: input.guildId,
    actorId: input.reviewerId,
    action: "code_access.review",
    targetType: "steam_username",
    targetId: steamUsername,
    details: { userId: input.userId, status: input.status },
  });

  return rows[0];
}

function extractSteamIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!url.hostname.toLocaleLowerCase("en-US").endsWith("steamcommunity.com")) return null;

    const [kind, identifier] = url.pathname.split("/").filter(Boolean);
    if ((kind === "id" || kind === "profiles") && identifier) {
      return decodeURIComponent(identifier);
    }
  } catch {
    // Plain username, not a URL.
  }

  return null;
}

function isHighConfidenceApproval(result: CodeAccessVerificationResult, now: Date): boolean {
  if (!result.fullScreenVisible || !result.dateTimeVisible || !result.purchaseLooksValid) {
    return false;
  }
  if (result.confidence < 0.85) return false;
  if (!hasDeviceFingerprint(result)) return false;

  const expiresAt = result.expiresAt ? new Date(`${result.expiresAt}T00:00:00.000Z`) : null;
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

function hasDeviceFingerprint(result: CodeAccessVerificationResult): boolean {
  const fingerprint = result.deviceFingerprint;
  return Boolean(
    fingerprint.serialNumber ||
      fingerprint.imei ||
      fingerprint.meid ||
      fingerprint.androidId ||
      fingerprint.udid ||
      fingerprint.hardwareId ||
      fingerprint.rawVisibleIdentifiers.length > 0,
  );
}

function publicVerificationMetadata(
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

function reviewDecisionToStatus(decision: "approve" | "deny" | "revoke"): "approved" | "rejected" | "revoked" {
  switch (decision) {
    case "approve":
      return "approved";
    case "deny":
      return "rejected";
    case "revoke":
      return "revoked";
  }
}
