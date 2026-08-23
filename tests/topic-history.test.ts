import { describe, expect, it } from "vitest";
import {
  analyzeTopicHistory,
  buildTopicHistorySnapshot,
  buildTopicSparkHumanPrompt,
  fetchRecentTopicHistory,
  prepareTopicSparkContext,
  type FetchableTopicChannel,
  type TopicHistoryMessage,
} from "../src/jobs/topic-history";

const now = new Date("2026-08-23T08:00:00.000Z");

function msg(input: Partial<TopicHistoryMessage> & { content: string; minutesAgo: number }): TopicHistoryMessage {
  return {
    id: input.id ?? `${input.authorId ?? "u"}-${input.minutesAgo}`,
    authorId: input.authorId ?? "u1",
    authorName: input.authorName ?? "Member",
    content: input.content,
    createdAt: new Date(now.getTime() - input.minutesAgo * 60_000),
    isBot: input.isBot ?? false,
  };
}

describe("topic history analysis", () => {
  it("blocks proactive topics while humans are actively chatting", () => {
    const snapshot = buildTopicHistorySnapshot({
      channelId: "c1",
      channelName: "general",
      fetchedAt: now,
      messages: [
        msg({ content: "Ai choi Valorant toi nay khong?", minutesAgo: 2 }),
        msg({ content: "Minh moi vao rank xong", minutesAgo: 5, authorId: "u2" }),
        msg({ content: "Can team 5 nguoi ne", minutesAgo: 9, authorId: "u3" }),
      ],
    });

    const analysis = analyzeTopicHistory(snapshot, { now, idleMinutes: 45 });

    expect(analysis.shouldSend).toBe(false);
    expect(analysis.reasons).toContain("channel_not_idle");
    expect(analysis.reasons).toContain("recent_human_burst");
    expect(analysis.dominantTopics).toContain("game");
  });

  it("blocks when the bot already spoke recently or was the last message", () => {
    const snapshot = buildTopicHistorySnapshot({
      channelId: "c1",
      channelName: "general",
      fetchedAt: now,
      messages: [
        msg({ content: "Moi nguoi dang choi game gi gan day?", minutesAgo: 60, isBot: true, authorId: "bot" }),
        msg({ content: "Hom qua minh xem phim moi", minutesAgo: 180 }),
      ],
    });

    const analysis = analyzeTopicHistory(snapshot, {
      now,
      idleMinutes: 45,
      botCooldownMinutes: 180,
    });

    expect(analysis.shouldSend).toBe(false);
    expect(analysis.reasons).toContain("last_message_from_bot");
    expect(analysis.reasons).toContain("recent_bot_message");
  });

  it("blocks repeated older bot content to avoid stale prompt loops", () => {
    const snapshot = buildTopicHistorySnapshot({
      channelId: "c1",
      channelName: "general",
      fetchedAt: now,
      messages: [
        msg({ content: "Hom nay moi nguoi dang choi game gi?", minutesAgo: 120, isBot: true, authorId: "bot" }),
        msg({ content: "Minh dang test vai thu", minutesAgo: 180 }),
        msg({ content: "Hom nay moi nguoi dang choi game gi?", minutesAgo: 240, isBot: true, authorId: "bot" }),
      ],
    });

    const analysis = analyzeTopicHistory(snapshot, {
      now,
      idleMinutes: 45,
      botCooldownMinutes: 90,
    });

    expect(analysis.shouldSend).toBe(false);
    expect(analysis.reasons).toContain("repeated_bot_content");
  });

  it("allows sending after a quiet channel and builds a context-aware prompt", () => {
    const snapshot = buildTopicHistorySnapshot({
      channelId: "c1",
      channelName: "general",
      fetchedAt: now,
      messages: [
        msg({ content: "Deadline bai tap mon lap trinh cang qua", minutesAgo: 120 }),
        msg({ content: "Co ai dung AI de debug code chua?", minutesAgo: 140, authorId: "u2" }),
      ],
    });

    const analysis = analyzeTopicHistory(snapshot, {
      now,
      idleMinutes: 45,
      botCooldownMinutes: 90,
    });
    const prompt = buildTopicSparkHumanPrompt(snapshot, analysis, {
      serverName: "Test Server",
    });

    expect(analysis.shouldSend).toBe(true);
    expect(analysis.dominantTopics).toEqual(expect.arrayContaining(["cong nghe", "hoc tap"]));
    expect(prompt).toContain("Kênh: #general");
    expect(prompt).toContain("Server: Test Server");
    expect(prompt).toContain("Deadline bai tap");
    expect(prompt).toContain("tranh lap lai");
  });

  it("sanitizes fetched Discord messages before putting them in context", async () => {
    const channel: FetchableTopicChannel = {
      id: "c1",
      name: "general",
      client: { user: { id: "bot" } },
      messages: {
        async fetch() {
          return [
            {
              id: "1",
              content: "Hello <@123456789012345678> xem https://example.com/test",
              createdTimestamp: now.getTime() - 120 * 60_000,
              author: { id: "u1", username: "Alice" },
            },
            {
              id: "2",
              content: "Bot topic cu",
              createdTimestamp: now.getTime() - 240 * 60_000,
              author: { id: "bot", username: "Bot" },
            },
          ];
        },
      },
    };

    const context = await prepareTopicSparkContext(channel, {
      now,
      serverName: "Test Server",
      idleMinutes: 45,
      botCooldownMinutes: 90,
    });

    expect(context.snapshot.messages[0].content).toBe("Hello @[user] xem [link]");
    expect(context.snapshot.messages[1].isBot).toBe(true);
    expect(context.analysis.shouldSend).toBe(true);
    expect(context.prompt).toContain("Hello @[user] xem [link]");
  });

  it("honors fetch limits when collecting recent history", async () => {
    const channel: FetchableTopicChannel = {
      id: "c1",
      name: "general",
      messages: {
        async fetch() {
          return [
            { id: "old", content: "old", createdTimestamp: now.getTime() - 300_000, author: { id: "u1" } },
            { id: "new", content: "new", createdTimestamp: now.getTime() - 60_000, author: { id: "u2" } },
          ];
        },
      },
    };

    const snapshot = await fetchRecentTopicHistory(channel, { now, limit: 1 });

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].id).toBe("new");
  });
});
