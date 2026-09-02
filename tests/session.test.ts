import { describe, expect, it } from "vitest";
import {
  MemoryConversationSessionStore,
  stripLeadingBotMention,
} from "../src/modules/discord/session";

const botId = "123456789012345678";

function msg(overrides: Partial<Parameters<MemoryConversationSessionStore["resolveMessage"]>[0]> = {}) {
  return {
    messageId: "m1",
    guildId: "g1",
    channelId: "c1",
    authorId: "u1",
    content: "hello",
    createdAt: 0,
    ...overrides,
  };
}

describe("stripLeadingBotMention", () => {
  it("removes the bot mention only when it is at the start", () => {
    expect(stripLeadingBotMention(`<@${botId}> xin chào`, botId)).toEqual({
      mentioned: true,
      mentionedUserId: botId,
      prompt: "xin chào",
    });
    expect(stripLeadingBotMention(`hello <@${botId}>`, botId)).toEqual({
      mentioned: false,
      prompt: `hello <@${botId}>`,
    });
  });
});

describe("MemoryConversationSessionStore", () => {
  it("opens a session on mention and continues without another mention", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000 });

    const first = store.resolveMessage(
      msg({ content: `<@${botId}> nhớ giúp mình luật server`, messageId: "m1" }),
      botId,
    );
    expect(first.shouldHandle).toBe(true);
    expect(first.shouldHandle && first.kind).toBe("start");
    expect(first.prompt).toBe("nhớ giúp mình luật server");

    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { requestId: "r1", botMessageId: "b1", now: 1_000 });

    const next = store.resolveMessage(
      msg({ content: "vậy rule về spam thì sao?", messageId: "m2", createdAt: 2_000 }),
      botId,
    );
    expect(next.shouldHandle).toBe(true);
    expect(next.shouldHandle && next.kind).toBe("continue");
    expect(next.prompt).toBe("vậy rule về spam thì sao?");
  });

  it("does not continue for a different user or channel", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000 });
    const first = store.resolveMessage(msg({ content: `<@${botId}> hi` }), botId);
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { botMessageId: "b1" });

    const otherUser = store.resolveMessage(
      msg({ authorId: "u2", content: "cho mình hỏi tiếp", messageId: "m2" }),
      botId,
    );
    const otherChannel = store.resolveMessage(
      msg({ channelId: "c2", content: "cho mình hỏi tiếp", messageId: "m3" }),
      botId,
    );

    if (otherUser.shouldHandle) throw new Error("expected other user to be ignored");
    if (otherChannel.shouldHandle) throw new Error("expected other channel to be ignored");
    expect(otherUser.shouldHandle).toBe(false);
    expect(otherUser.reason).toBe("no_active_session");
    expect(otherChannel.shouldHandle).toBe(false);
    expect(otherChannel.reason).toBe("no_active_session");
  });

  it("expires sessions after the configured ttl", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 1_000 });
    const first = store.resolveMessage(
      msg({ content: `<@${botId}> mở phiên`, createdAt: 0 }),
      botId,
    );
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { now: 0 });

    const expired = store.resolveMessage(
      msg({ content: "còn nghe không?", messageId: "m2", createdAt: 1_001 }),
      botId,
    );

    if (expired.shouldHandle) throw new Error("expected expired session to be ignored");
    expect(expired.shouldHandle).toBe(false);
    expect(expired.reason).toBe("no_active_session");
    expect(store.size()).toBe(0);
  });

  it("treats a direct reply to the last bot response as a continuation", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000 });
    const first = store.resolveMessage(msg({ content: `<@${botId}> hi` }), botId);
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { botMessageId: "bot-reply-1", now: 0 });

    const reply = store.resolveMessage(
      msg({
        content: "nói rõ hơn đoạn đó",
        referencedMessageId: "bot-reply-1",
        messageId: "m2",
        createdAt: 10,
      }),
      botId,
    );

    expect(reply.shouldHandle).toBe(true);
    expect(reply.shouldHandle && reply.replyToBot).toBe(true);
  });

  it("locks a session while a turn is in flight and unlocks after abandon", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000, lockTtlMs: 30_000 });
    const first = store.resolveMessage(
      msg({ content: `<@${botId}> chạy việc này`, createdAt: 0 }),
      botId,
    );
    if (!first.shouldHandle) throw new Error("expected first message to be handled");

    const busy = store.resolveMessage(
      msg({ content: "thêm ý này nữa", messageId: "m2", createdAt: 1_000 }),
      botId,
    );
    if (busy.shouldHandle) throw new Error("expected active turn to lock the session");
    expect(busy.shouldHandle).toBe(false);
    expect(busy.reason).toBe("session_busy");

    store.abandonTurn(first.session.id);
    const retried = store.resolveMessage(
      msg({ content: "thêm ý này nữa", messageId: "m3", createdAt: 2_000 }),
      botId,
    );
    expect(retried.shouldHandle).toBe(true);
  });

  it("refreshes an existing session when the user mentions the bot again", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000 });
    const first = store.resolveMessage(
      msg({ content: `<@${botId}> câu đầu`, messageId: "m1", createdAt: 0 }),
      botId,
    );
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { botMessageId: "b1", now: 100 });

    const refreshed = store.resolveMessage(
      msg({ content: `<@${botId}> chủ đề mới`, messageId: "m2", createdAt: 200 }),
      botId,
    );

    expect(refreshed.shouldHandle).toBe(true);
    expect(refreshed.shouldHandle && refreshed.kind).toBe("start");
    expect(refreshed.shouldHandle && refreshed.session.turnCount).toBe(1);
    expect(refreshed.shouldHandle && refreshed.session.openedByMessageId).toBe("m2");
  });

  it("ignores foreign leading mentions and clears expired locks", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 60_000, lockTtlMs: 1_000 });
    const first = store.resolveMessage(
      msg({ content: `<@${botId}> mở phiên`, messageId: "m1", createdAt: 0 }),
      botId,
    );
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { botMessageId: "b1", now: 0 });

    const foreignMention = store.resolveMessage(
      msg({ content: "<@999999999999999999> bạn xem giúp", messageId: "m2", createdAt: 100 }),
      botId,
    );
    if (foreignMention.shouldHandle) throw new Error("expected foreign mention to be ignored");
    expect(foreignMention.reason).toBe("foreign_mention");

    const locked = store.resolveMessage(
      msg({ content: "lượt đang chạy", messageId: "m3", createdAt: 200 }),
      botId,
    );
    expect(locked.shouldHandle).toBe(true);

    const afterLockTtl = store.resolveMessage(
      msg({ content: "sau lock ttl", messageId: "m4", createdAt: 1_250 }),
      botId,
    );
    expect(afterLockTtl.shouldHandle).toBe(true);
  });

  it("closes sessions at max turns and sweeps expired sessions", () => {
    const store = new MemoryConversationSessionStore({ ttlMs: 1_000, maxTurns: 1 });
    const first = store.resolveMessage(
      msg({ content: `<@${botId}> mở phiên`, messageId: "m1", createdAt: 0 }),
      botId,
    );
    if (!first.shouldHandle) throw new Error("expected first message to be handled");
    store.finishTurn(first.session.id, { now: 0 });

    const maxed = store.resolveMessage(
      msg({ content: "turn tiếp", messageId: "m2", createdAt: 100 }),
      botId,
    );
    if (maxed.shouldHandle) throw new Error("expected max turns to close the session");
    expect(maxed.reason).toBe("max_turns_reached");

    const second = store.resolveMessage(
      msg({ content: `<@${botId}> mở lại`, messageId: "m3", createdAt: 200 }),
      botId,
    );
    if (!second.shouldHandle) throw new Error("expected second session to be handled");
    store.finishTurn(second.session.id, { now: 200 });
    expect(store.sweepExpired(1_201)).toBe(1);
    expect(store.size()).toBe(0);
  });
});
