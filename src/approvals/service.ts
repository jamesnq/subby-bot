import { sql } from "drizzle-orm";
import { db } from "../database/db";
import { approvalRequests } from "../database/schema";
import { planHash } from "../shared/ids";
import type { PlannedCall } from "../policies/types";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRecord = {
  requestId: string;
  guildId: string;
  channelId: string;
  requesterId: string;
  approverId: string | null;
  risk: string;
  status: ApprovalStatus;
  planJson: PlannedCall[];
  planHash: string;
  previewMessageId: string | null;
  expiresAt: Date;
};

export async function createApprovalRequest(params: {
  requestId: string;
  guildId: string;
  channelId: string;
  requesterId: string;
  risk: string;
  calls: PlannedCall[];
  ttlSeconds: number;
}): Promise<{ expiresAt: Date; hash: string }> {
  const hash = planHash(params.calls);
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);

  await db.insert(approvalRequests).values({
    requestId: params.requestId,
    guildId: params.guildId,
    channelId: params.channelId,
    requesterId: params.requesterId,
    risk: params.risk,
    status: "pending",
    planJson: params.calls as unknown as Record<string, unknown>[],
    planHash: hash,
    expiresAt,
  });

  return { expiresAt, hash };
}

export async function setPreviewMessageId(requestId: string, messageId: string): Promise<void> {
  await db.update(approvalRequests)
    .set({ previewMessageId: messageId })
    .where(sql`${approvalRequests.requestId} = ${requestId}`);
}

export async function getApprovalRequest(requestId: string): Promise<ApprovalRecord | null> {
  const rows = await db.select()
    .from(approvalRequests)
    .where(sql`${approvalRequests.requestId} = ${requestId}`)
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    requestId: r.requestId,
    guildId: r.guildId,
    channelId: r.channelId,
    requesterId: r.requesterId,
    approverId: r.approverId,
    risk: r.risk,
    status: r.status as ApprovalStatus,
    planJson: r.planJson as unknown as PlannedCall[],
    planHash: r.planHash,
    previewMessageId: r.previewMessageId,
    expiresAt: r.expiresAt,
  };
}

export async function decideApproval(
  requestId: string,
  decision: "approved" | "rejected",
  approverId: string,
): Promise<ApprovalRecord | null> {
  const updated = await db.update(approvalRequests)
    .set({ status: decision, approverId, decidedAt: new Date() })
    .where(
      sql`${approvalRequests.requestId} = ${requestId}
          AND ${approvalRequests.status} = 'pending'
          AND ${approvalRequests.expiresAt} > now()`,
    )
    .returning();

  if (updated.length === 0) return null;
  const r = updated[0];
  return {
    requestId: r.requestId,
    guildId: r.guildId,
    channelId: r.channelId,
    requesterId: r.requesterId,
    approverId: r.approverId,
    risk: r.risk,
    status: r.status as ApprovalStatus,
    planJson: r.planJson as unknown as PlannedCall[],
    planHash: r.planHash,
    previewMessageId: r.previewMessageId,
    expiresAt: r.expiresAt,
  };
}

export function verifyPlanIntegrity(record: ApprovalRecord): boolean {
  return planHash(record.planJson) === record.planHash;
}


