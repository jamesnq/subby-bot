import { and, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import {
  codeAccessEntitlements,
  type CodeAccessEntitlementRow,
} from "../../database/schema";
import type { CodeAccessVerificationResult } from "../verification";
import { isAllowedCodeAccessAccount, normalizeSteamUsername } from "../accounts";
import { hasDeviceFingerprint } from "./fingerprint";

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
  if (!isAllowedCodeAccessAccount(steamUsername)) {
    await writeAudit({
      guildId: input.guildId,
      actorId: input.reviewerId,
      action: "code_access.review",
      targetType: "steam_username",
      targetId: steamUsername || "[invalid]",
      details: { userId: input.userId, status: input.status, reason: "account_not_found" },
    });
    return undefined;
  }
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

export function isHighConfidenceApproval(result: CodeAccessVerificationResult, now: Date): boolean {
  if (!result.fullScreenVisible || !result.dateTimeVisible || !result.purchaseLooksValid) {
    return false;
  }
  if (result.confidence < 0.85) return false;
  if (!hasDeviceFingerprint(result)) return false;

  const expiresAt = result.expiresAt ? new Date(`${result.expiresAt}T00:00:00.000Z`) : null;
  return Boolean(expiresAt && expiresAt.getTime() > now.getTime());
}

export function reviewDecisionToStatus(decision: "approve" | "deny" | "revoke"): "approved" | "rejected" | "revoked" {
  switch (decision) {
    case "approve":
      return "approved";
    case "deny":
      return "rejected";
    case "revoke":
      return "revoked";
  }
}
