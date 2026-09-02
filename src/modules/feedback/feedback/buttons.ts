import { and, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import { aiResponseSnapshots, feedback } from "../../database/schema";
import { deleteCachedAnswerByKey } from "../../knowledge/cache";
import { improvementSuggestion } from "./snapshots";

export async function recordFeedbackFromButton(input: {
  requestId: string;
  guildId: string;
  userId: string;
  rating: "up" | "down";
}): Promise<{ cacheInvalidated: boolean }> {
  const [snapshot] = await db
    .select()
    .from(aiResponseSnapshots)
    .where(eq(aiResponseSnapshots.requestId, input.requestId))
    .limit(1);

  let cacheInvalidated = false;
  if (
    input.rating === "down" &&
    snapshot?.queryHash &&
    snapshot.roleScopeHash
  ) {
    cacheInvalidated = await deleteCachedAnswerByKey(
      input.guildId,
      snapshot.queryHash,
      snapshot.roleScopeHash,
    );
  }

  await db.insert(feedback).values({
    requestId: input.requestId || "unknown",
    guildId: input.guildId,
    userId: input.userId,
    rating: input.rating,
    reviewStatus: input.rating === "down" ? "pending" : "positive",
    cacheInvalidated,
  }).onConflictDoUpdate({
    target: [feedback.requestId, feedback.userId],
    set: {
      rating: input.rating,
      reviewStatus: input.rating === "down" ? "pending" : "positive",
      reviewedAt: null,
      reviewedBy: null,
      cacheInvalidated,
      createdAt: new Date(),
    },
  });

  await writeAudit({
    requestId: input.requestId,
    guildId: input.guildId,
    actorId: input.userId,
    action: `feedback.${input.rating}`,
    targetType: "request",
    targetId: input.requestId,
    details: {
      cacheInvalidated,
      snapshotFound: Boolean(snapshot),
      suggestion: input.rating === "down" ? improvementSuggestion(snapshot ?? null) : undefined,
    },
  });

  return { cacheInvalidated };
}

export async function markFeedbackReviewed(
  guildId: string,
  requestId: string,
  reviewerId: string,
): Promise<number> {
  const rows = await db
    .update(feedback)
    .set({
      reviewStatus: "reviewed",
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(feedback.guildId, guildId),
        eq(feedback.requestId, requestId),
        eq(feedback.rating, "down"),
      ),
    )
    .returning({ id: feedback.id });

  await writeAudit({
    requestId,
    guildId,
    actorId: reviewerId,
    action: "feedback.reviewed",
    targetType: "request",
    targetId: requestId,
    details: { count: rows.length },
  });

  return rows.length;
}
