import { describe, expect, it } from "vitest";
import {
  buildConversationSessionScope,
  conversationSessionKey,
  formatSessionHistoryForPrompt,
  normalizeSessionHistoryRows,
} from "../src/agent/session-context";
import type { AgentState } from "../src/agent/state";

describe("session context helpers", () => {
  it("scopes follow-up history to guild, channel, and user", () => {
    const scope = buildConversationSessionScope({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      requestId: "request-1",
    } as AgentState);

    expect(scope).toEqual({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
    });
    expect(conversationSessionKey(scope)).toBe("guild-1:channel-1:user-1");
  });

  it("normalizes unknown roles as user and truncates long lines", () => {
    const history = normalizeSessionHistoryRows(
      [
        { role: "system", content: "hello" },
        { role: "assistant", content: "abcdef" },
      ],
      { maxLineChars: 3 },
    );

    expect(history).toEqual([
      { role: "user", content: "hel" },
      { role: "assistant", content: "abc" },
    ]);
  });

  it("formats prompt history compatibly with the current chat prompt", () => {
    const prompt = formatSessionHistoryForPrompt([
      { role: "user", content: "Tao channel cho team dev" },
      { role: "assistant", content: "Mình đã tạo #team-dev." },
    ]);

    expect(prompt).toContain("HỘI THOẠI GẦN ĐÂY");
    expect(prompt).toContain("Người dùng: Tao channel cho team dev");
    expect(prompt).toContain("Bot: Mình đã tạo #team-dev.");
    expect(prompt.endsWith("\n\n")).toBe(true);
  });

  it("omits empty history blocks", () => {
    expect(formatSessionHistoryForPrompt([])).toBe("");
  });
});
