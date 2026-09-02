import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { aiResponseSnapshots, feedback } from "../../database/schema";
import { stripPublicCitations } from "@shared/sanitize";
import { improvementSuggestion } from "./snapshots";

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
