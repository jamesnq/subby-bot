import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../database/db";
import {
  codeAccessFeedbackRequests,
  codeAccessPenalties,
  feedback,
  type CodeAccessFeedbackRequestRow,
  type CodeAccessPenaltyRow,
} from "../database/schema";

/**
 * After a successful `/code request`, the user gets this long to click the
 * 👍/👎 feedback buttons before it counts as "didn't confirm".
 */
export const FEEDBACK_GRACE_MS = 60 * 60_000; // 1h
/** One nudge, sent at the halfway point if still unresolved. */
export const FEEDBACK_REMINDER_MS = FEEDBACK_GRACE_MS / 2;
export const FEEDBACK_PENALTY_DAYS = 7;
export const FEEDBACK_PENALTY_MS = FEEDBACK_PENALTY_DAYS * 24 * 60 * 60_000;

/** Called once, right after closeCodeThread() asks for feedback on a `/code request` success. */
export async function createFeedbackObligation(input: {
  guildId: string;
  userId: string;
  threadId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db.insert(codeAccessFeedbackRequests).values({
    guildId: input.guildId,
    userId: input.userId,
    threadId: input.threadId,
    issuedAt: now,
    reminderAt: new Date(now.getTime() + FEEDBACK_REMINDER_MS),
    deadlineAt: new Date(now.getTime() + FEEDBACK_GRACE_MS),
  }).onConflictDoNothing({ target: codeAccessFeedbackRequests.threadId });
}

/**
 * Instant-path lift: called from the generic aifeedback:* button handler
 * right after it records a rating, so giving feedback — even late, even
 * after the 7-day penalty already landed — clears it immediately instead of
 * waiting for the next sweep. A no-op (and cheap) when `threadId` isn't a
 * code-access thread awaiting feedback.
 */
export async function resolveFeedbackObligation(input: {
  guildId: string;
  userId: string;
  threadId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const rows = await db.update(codeAccessFeedbackRequests).set({ resolvedAt: now }).where(and(
    eq(codeAccessFeedbackRequests.threadId, input.threadId),
    eq(codeAccessFeedbackRequests.userId, input.userId),
    isNull(codeAccessFeedbackRequests.resolvedAt),
  )).returning();
  if (rows.length === 0 || !rows[0].penalizedAt) return;
  await liftPenalty({ guildId: input.guildId, userId: input.userId, now });
}

export async function getActivePenalty(input: {
  guildId: string;
  userId: string;
  now?: Date;
}): Promise<CodeAccessPenaltyRow | undefined> {
  const now = input.now ?? new Date();
  const rows = await db.select().from(codeAccessPenalties).where(and(
    eq(codeAccessPenalties.guildId, input.guildId),
    eq(codeAccessPenalties.userId, input.userId),
    gt(codeAccessPenalties.bannedUntil, now),
    isNull(codeAccessPenalties.liftedAt),
  )).limit(1);
  return rows[0];
}

async function liftPenalty(input: { guildId: string; userId: string; now: Date }): Promise<void> {
  await db.update(codeAccessPenalties).set({ liftedAt: input.now }).where(and(
    eq(codeAccessPenalties.guildId, input.guildId),
    eq(codeAccessPenalties.userId, input.userId),
    isNull(codeAccessPenalties.liftedAt),
  ));
}

export type FeedbackSweepResult = {
  resolved: CodeAccessFeedbackRequestRow[];
  reminders: CodeAccessFeedbackRequestRow[];
  penalties: Array<{ row: CodeAccessFeedbackRequestRow; bannedUntil: Date }>;
};

/**
 * Runs on the same 5-minute cadence as the other code-access sweeps
 * (jobs/scheduler.ts). Three independent passes over open obligations:
 * resolve (feedback landed since last sweep — also lifts a penalty, the
 * backstop for resolveFeedbackObligation missing a case), remind (halfway
 * through the grace window), penalize (grace window elapsed, still open).
 */
export async function sweepMissingFeedback(now = new Date()): Promise<FeedbackSweepResult> {
  const open = await db.select().from(codeAccessFeedbackRequests).where(isNull(codeAccessFeedbackRequests.resolvedAt));

  const resolved: CodeAccessFeedbackRequestRow[] = [];
  for (const row of open) {
    const given = await db.select({ id: feedback.id }).from(feedback).where(and(
      eq(feedback.requestId, row.threadId),
      eq(feedback.userId, row.userId),
    )).limit(1);
    if (given.length === 0) continue;
    await db.update(codeAccessFeedbackRequests).set({ resolvedAt: now }).where(eq(codeAccessFeedbackRequests.id, row.id));
    resolved.push(row);
    if (row.penalizedAt) await liftPenalty({ guildId: row.guildId, userId: row.userId, now });
  }
  const resolvedIds = new Set(resolved.map((row) => row.id));
  const stillOpen = open.filter((row) => !resolvedIds.has(row.id));

  const reminders: CodeAccessFeedbackRequestRow[] = [];
  for (const row of stillOpen) {
    if (row.reminderSentAt || row.reminderAt.getTime() > now.getTime()) continue;
    await db.update(codeAccessFeedbackRequests).set({ reminderSentAt: now }).where(eq(codeAccessFeedbackRequests.id, row.id));
    reminders.push(row);
  }

  const penalties: FeedbackSweepResult["penalties"] = [];
  for (const row of stillOpen) {
    if (row.penalizedAt || row.deadlineAt.getTime() > now.getTime()) continue;
    const bannedUntil = new Date(now.getTime() + FEEDBACK_PENALTY_MS);
    await db.update(codeAccessFeedbackRequests).set({ penalizedAt: now }).where(eq(codeAccessFeedbackRequests.id, row.id));
    await db.insert(codeAccessPenalties).values({
      guildId: row.guildId, userId: row.userId, reason: "missing_feedback", bannedUntil,
    }).onConflictDoUpdate({
      target: [codeAccessPenalties.guildId, codeAccessPenalties.userId],
      set: { bannedUntil, liftedAt: null, reason: "missing_feedback", createdAt: now },
    });
    penalties.push({ row, bannedUntil });
  }

  return { resolved, reminders, penalties };
}
