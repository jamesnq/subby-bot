import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../database/db";
import { aiResponseSnapshots, feedback } from "../database/schema";
import { writeAudit } from "../database/audit";
import { deleteCachedAnswerByKey, queryHashOf, roleScopeHash } from "../knowledge/cache";
import { stripPublicCitations } from "../shared/sanitize";
import type { AgentState } from "../agent/state";

type FeedbackSnapshot = typeof aiResponseSnapshots.$inferSelect;

export async function storeResponseSnapshot(state: AgentState): Promise<void> {
  if (!state.finalResponse) return;

  try {
    await db
      .insert(aiResponseSnapshots)
      .values({
        requestId: state.requestId,
        guildId: state.guildId,
        channelId: state.channelId,
        userId: state.userId,
        question: state.input.slice(0, 4000),
        answer: stripPublicCitations(state.finalResponse).slice(0, 4000),
        intent: state.intent,
        queryHash: state.intent === "knowledge" ? queryHashOf(state.input) : null,
        roleScopeHash: state.intent === "knowledge" ? roleScopeHash(state.memberRoleIds) : null,
        cached: Boolean(state.cachedAnswer),
        retrievedChunks: (state.retrievedContext ?? []).slice(0, 8).map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          title: c.title,
          sourceType: c.sourceType,
          score: Number(c.score.toFixed(4)),
        })),
      })
      .onConflictDoUpdate({
        target: aiResponseSnapshots.requestId,
        set: {
          answer: stripPublicCitations(state.finalResponse).slice(0, 4000),
          intent: state.intent,
          cached: Boolean(state.cachedAnswer),
          retrievedChunks: (state.retrievedContext ?? []).slice(0, 8).map((c) => ({
            chunkId: c.chunkId,
            documentId: c.documentId,
            title: c.title,
            sourceType: c.sourceType,
            score: Number(c.score.toFixed(4)),
          })),
        },
      });
  } catch {
    // feedback snapshots are best-effort; user response should not fail.
  }
}

export function improvementSuggestion(snapshot: Pick<FeedbackSnapshot, "intent" | "answer" | "retrievedChunks"> | null): string {
  if (!snapshot) return "Không tìm thấy snapshot. Kiểm tra log theo request id.";

  const answer = snapshot.answer.toLowerCase();
  const chunks = snapshot.retrievedChunks ?? [];
  const hasProduct = chunks.some((c) => c.sourceType === "product");

  if (snapshot.intent === "knowledge" && hasProduct && /id|slug|trạng thái|đã bán|biến thể/i.test(snapshot.answer)) {
    return "Ẩn metadata sản phẩm trong formatter/prompt và invalidate cache câu này.";
  }
  if (snapshot.intent === "knowledge" && hasProduct) {
    return "Kiểm tra alias/từ khóa sản phẩm hoặc giá trong CSV; nếu cần, thêm FAQ ngắn cho câu hỏi này.";
  }
  if (snapshot.intent === "knowledge") {
    return "Kiểm tra knowledge chunk đã retrieve; có thể cần bổ sung tài liệu hoặc tăng độ chính xác retrieval.";
  }
  if (/xin lỗi|không chắc|chưa tìm thấy/.test(answer)) {
    return "Câu trả lời thiếu dữ liệu. Cân nhắc thêm knowledge base hoặc hướng dẫn fallback rõ hơn.";
  }
  return "Đọc lại câu hỏi/câu trả lời và thêm rule hoặc knowledge nếu lỗi lặp lại.";
}

export function renderFeedbackReport(rows: FeedbackReportRow[]): string {
  if (rows.length === 0) {
    return "✅ Chưa có feedback xấu nào đang chờ review.";
  }

  const lines = ["📋 Feedback xấu cần review:"];
  for (const row of rows) {
    lines.push("");
    lines.push(`Request: \`${row.requestId}\``);
    lines.push(`User: <@${row.userId}> · ${row.createdAt.toISOString().slice(0, 16).replace("T", " ")}`);
    lines.push(`Hỏi: ${oneLine(row.question ?? "(không có snapshot)", 180)}`);
    lines.push(`Bot: ${oneLine(row.answer ?? "(không có snapshot)", 220)}`);
    lines.push(`Gợi ý: ${row.suggestion}`);
  }
  lines.push("");
  lines.push("Dùng `/ai-config feedback action:mark_reviewed request_id:<request>` sau khi đã xử lý.");
  return lines.join("\n").slice(0, 1900);
}

export type FeedbackReportRow = {
  requestId: string;
  userId: string;
  createdAt: Date;
  question: string | null;
  answer: string | null;
  suggestion: string;
};

export async function listPendingBadFeedback(guildId: string, limit = 5): Promise<FeedbackReportRow[]> {
  const rows = await db
    .select({
      requestId: feedback.requestId,
      userId: feedback.userId,
      createdAt: feedback.createdAt,
      question: aiResponseSnapshots.question,
      answer: aiResponseSnapshots.answer,
      intent: aiResponseSnapshots.intent,
      retrievedChunks: aiResponseSnapshots.retrievedChunks,
    })
    .from(feedback)
    .leftJoin(aiResponseSnapshots, eq(aiResponseSnapshots.requestId, feedback.requestId))
    .where(
      and(
        eq(feedback.guildId, guildId),
        eq(feedback.rating, "down"),
        eq(feedback.reviewStatus, "pending"),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    requestId: row.requestId,
    userId: row.userId,
    createdAt: row.createdAt,
    question: row.question,
    answer: row.answer ? stripPublicCitations(row.answer) : null,
    suggestion: improvementSuggestion({
      intent: row.intent,
      answer: row.answer ?? "",
      retrievedChunks: row.retrievedChunks ?? [],
    }),
  }));
}

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

export async function feedbackStats(guildId: string): Promise<string> {
  const rows = await db
    .select({
      rating: feedback.rating,
      reviewStatus: feedback.reviewStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(feedback)
    .where(eq(feedback.guildId, guildId))
    .groupBy(feedback.rating, feedback.reviewStatus);

  if (rows.length === 0) return "Chưa có feedback nào.";
  return rows
    .map((row) => `${row.rating}/${row.reviewStatus}: ${row.count}`)
    .join("\n");
}

function oneLine(text: string, max: number): string {
  const cleaned = stripPublicCitations(text)
    .replace(/\b(?:api[_ -]?key|token|sourceScope|operationScope)\b\s*[:=]?\s*\S*/gi, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}
