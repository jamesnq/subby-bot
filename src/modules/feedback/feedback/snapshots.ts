import { db } from "../../database/db";
import { aiResponseSnapshots } from "../../database/schema";
import { queryHashOf, roleScopeHash } from "../../knowledge/cache";
import { stripPublicCitations } from "@shared/sanitize";
import type { AgentState } from "../../agent/state";

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
