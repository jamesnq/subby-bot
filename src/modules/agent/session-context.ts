import { and, desc, eq } from "drizzle-orm";
import { db } from "../database/db";
import { conversationMessages } from "../database/schema";
import type { AgentState } from "./state";

export type SessionHistoryRole = "user" | "assistant";

export type SessionHistoryLine = {
  role: SessionHistoryRole;
  content: string;
};

export type ConversationSessionScope = {
  guildId: string;
  channelId: string;
  userId: string;
};

export type SessionHistoryOptions = {
  limit?: number;
  maxLineChars?: number;
};

const DEFAULT_HISTORY_MESSAGES = 8;
const DEFAULT_MAX_LINE_CHARS = 300;

export function buildConversationSessionScope(
  state: Pick<AgentState, "guildId" | "channelId" | "userId">,
): ConversationSessionScope {
  return {
    guildId: state.guildId,
    channelId: state.channelId,
    userId: state.userId,
  };
}

export function conversationSessionKey(scope: ConversationSessionScope): string {
  return `${scope.guildId}:${scope.channelId}:${scope.userId}`;
}

export function normalizeSessionHistoryRows(
  rows: Array<{ role: string; content: string }>,
  options: SessionHistoryOptions = {},
): SessionHistoryLine[] {
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  return rows.map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content.slice(0, maxLineChars),
  }));
}

export async function fetchSessionHistory(
  scope: ConversationSessionScope,
  options: SessionHistoryOptions = {},
): Promise<SessionHistoryLine[]> {
  const limit = options.limit ?? DEFAULT_HISTORY_MESSAGES;

  try {
    const rows = await db
      .select({ role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.guildId, scope.guildId),
          eq(conversationMessages.channelId, scope.channelId),
          eq(conversationMessages.userId, scope.userId),
        ),
      )
      .orderBy(desc(conversationMessages.createdAt))
      .limit(limit);

    return normalizeSessionHistoryRows(rows.reverse(), options);
  } catch {
    return [];
  }
}

export function formatSessionHistoryForPrompt(history: SessionHistoryLine[]): string {
  if (history.length === 0) return "";
  const lines = history.map((line) =>
    `${line.role === "user" ? "Người dùng" : "Bot"}: ${line.content}`,
  );
  return `HỘI THOẠI GẦN ĐÂY (để hiểu ngữ cảnh):\n${lines.join("\n")}\n\n`;
}

export async function buildSessionHistoryPrompt(
  scope: ConversationSessionScope,
  options: SessionHistoryOptions = {},
): Promise<string> {
  return formatSessionHistoryForPrompt(await fetchSessionHistory(scope, options));
}
