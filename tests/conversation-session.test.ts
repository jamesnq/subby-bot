import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "../src/agent/state";

const {
  dbMock,
  insertChain,
  selectChain,
  writeAuditMock,
  handleAskInteractionMock,
} = vi.hoisted(() => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    selectChain,
    insertChain,
    writeAuditMock: vi.fn().mockResolvedValue(undefined),
    handleAskInteractionMock: vi.fn(),
    dbMock: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

vi.mock("../src/database/db", () => ({ db: dbMock }));
vi.mock("../src/database/audit", () => ({ writeAudit: writeAuditMock }));
vi.mock("../src/discord/commands/ai", () => ({
  handleAskInteraction: handleAskInteractionMock,
}));
vi.mock("../src/discord/commands/ai-config", () => ({
  handleAiConfig: vi.fn(),
}));
vi.mock("../src/discord/components/approval-buttons", () => ({
  APPROVE_PREFIX: "aiapprove:",
  CANCEL_PREFIX: "aicancel:",
  handleApprovalButton: vi.fn(),
}));
vi.mock("../src/discord/components/feedback-buttons", () => ({
  FEEDBACK_PREFIX: "aifeedback:",
  handleFeedbackButton: vi.fn(),
}));

import { auditNode } from "../src/agent/nodes/audit-node";
import { fetchRecentHistory, formatHistoryForPrompt } from "../src/agent/memory";
import { registerInteractionCreate } from "../src/discord/events/interaction-create";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.select.mockReturnValue(selectChain);
  dbMock.insert.mockReturnValue(insertChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.orderBy.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  insertChain.values.mockResolvedValue(undefined);
  writeAuditMock.mockResolvedValue(undefined);
});

describe("conversation session history", () => {
  it("returns recent messages in chronological order and trims prompt payload", async () => {
    selectChain.limit.mockResolvedValueOnce([
      { role: "assistant", content: "latest assistant" },
      { role: "user", content: "x".repeat(350) },
      { role: "system", content: "older unknown role" },
    ]);

    const history = await fetchRecentHistory("guild-1", "user-1");

    expect(selectChain.limit).toHaveBeenCalledWith(8);
    expect(history).toEqual([
      { role: "user", content: "older unknown role" },
      { role: "user", content: "x".repeat(300) },
      { role: "assistant", content: "latest assistant" },
    ]);
  });

  it("formats history for the chat prompt and keeps empty history silent", () => {
    expect(formatHistoryForPrompt([])).toBe("");

    const promptHistory = formatHistoryForPrompt([
      { role: "user", content: "Cau truoc la gi?" },
      { role: "assistant", content: "Minh da tra loi roi." },
    ]);

    expect(promptHistory).toBe(
      [
        "HỘI THOẠI GẦN ĐÂY (để hiểu ngữ cảnh):",
        "Người dùng: Cau truoc la gi?",
        "Bot: Minh da tra loi roi.",
        "",
        "",
      ].join("\n"),
    );
  });

  it("falls back to empty history when the database read fails", async () => {
    dbMock.select.mockImplementationOnce(() => {
      throw new Error("db offline");
    });

    await expect(fetchRecentHistory("guild-1", "user-1")).resolves.toEqual([]);
  });
});

describe("conversation session persistence", () => {
  it("stores user and assistant messages with deduplicated citations", async () => {
    const longResponse = "a".repeat(4_050);

    await auditNode({
      requestId: "req-1",
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      input: "follow-up question",
      finalResponse: longResponse,
      intent: "knowledge",
      riskLevel: "read",
      proposedCalls: [{ name: "search_knowledge", args: {} }],
      retrievedContext: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          title: "Doc 1",
          sourceType: "manual",
          content: "A",
          score: 0.9,
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-1",
          title: "Doc 1",
          sourceType: "manual",
          content: "B",
          score: 0.8,
        },
      ],
    } as unknown as AgentState);

    expect(writeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        action: "ai.request.completed",
        status: "ok",
      }),
    );
    expect(insertChain.values).toHaveBeenCalledWith([
      {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-1",
        role: "user",
        content: "follow-up question",
      },
      {
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-1",
        role: "assistant",
        content: longResponse.slice(0, 4000),
        citations: ["doc-1"],
      },
    ]);
  });

  it("does not fail the request when session persistence is unavailable", async () => {
    insertChain.values.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      auditNode({
        requestId: "req-2",
        guildId: "guild-1",
        channelId: "channel-1",
        userId: "user-1",
        input: "hello",
        finalResponse: "hi",
      } as unknown as AgentState),
    ).resolves.toEqual({});
  });
});

describe("interaction follow-up error handling", () => {
  it("uses followUp instead of reply when a deferred interaction errors", async () => {
    handleAskInteractionMock.mockRejectedValueOnce(new Error("handler failed"));

    let interactionHandler: ((interaction: unknown) => Promise<void>) | undefined;
    const client = {
      on: vi.fn((_event, handler) => {
        interactionHandler = handler;
      }),
    };
    registerInteractionCreate(client as never);

    const interaction = {
      commandName: "ai",
      deferred: true,
      replied: false,
      isChatInputCommand: () => true,
      isButton: () => false,
      isRepliable: () => true,
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await interactionHandler?.(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: "⚠️ Đã xảy ra lỗi khi xử lý yêu cầu.",
      flags: 64,
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
