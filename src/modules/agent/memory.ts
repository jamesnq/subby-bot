import { and, desc, eq } from "drizzle-orm";
import { db } from "../database/db";
import { conversationMessages } from "../database/schema";

export type HistoryLine = { role: "user" | "assistant"; content: string };

const MAX_HISTORY_MESSAGES = 8;
const MAX_LINE_CHARS = 300;

export async function fetchRecentHistory(
  guildId: string,
  userId: string,
): Promise<HistoryLine[]> {
  try {
    const rows = await db
      .select({ role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages)
      .where(and(eq(conversationMessages.guildId, guildId), eq(conversationMessages.userId, userId)))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(MAX_HISTORY_MESSAGES);

    return rows
      .reverse()
      .map((r) => ({
        role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: r.content.slice(0, MAX_LINE_CHARS),
      }));
  } catch {
    return [];
  }
}

export function formatHistoryForPrompt(history: HistoryLine[]): string {
  if (history.length === 0) return "";
  const lines = history.map((h) => `${h.role === "user" ? "Người dùng" : "Bot"}: ${h.content}`);
  return `HỘI THOẠI GẦN ĐÂY (để hiểu ngữ cảnh):\n${lines.join("\n")}\n\n`;
}
