import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";

const {
  runAgentMock,
  writeAuditMock,
  getGuildSettingsMock,
  isAiChannelAllowedMock,
  hasAllowedRoleMock,
  checkBudgetMock,
  storeResponseSnapshotMock,
  setPreviewMessageIdMock,
} = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  writeAuditMock: vi.fn(),
  getGuildSettingsMock: vi.fn(),
  isAiChannelAllowedMock: vi.fn(),
  hasAllowedRoleMock: vi.fn(),
  checkBudgetMock: vi.fn(),
  storeResponseSnapshotMock: vi.fn(),
  setPreviewMessageIdMock: vi.fn(),
}));

vi.mock("../src/agent/graph", () => ({ runAgent: runAgentMock }));
vi.mock("../src/database/audit", () => ({ writeAudit: writeAuditMock }));
vi.mock("../src/discord/permissions/guard", () => ({
  getGuildSettings: getGuildSettingsMock,
  isAiChannelAllowed: isAiChannelAllowedMock,
  hasAllowedRole: hasAllowedRoleMock,
  isUserWithinRateLimit: vi.fn(() => true),
  memberRoleIds: vi.fn(() => ["role-1"]),
}));
vi.mock("../src/discord/components/approval-buttons", () => ({
  approvalComponents: vi.fn(() => []),
  previewEmbed: vi.fn(() => ({ title: "preview" })),
}));
vi.mock("../src/discord/components/feedback-buttons", () => ({
  feedbackRow: vi.fn(() => ({ type: 1, components: [] })),
}));
vi.mock("../src/discord/typing", () => ({
  startTypingLoop: vi.fn(() => undefined),
  stopTypingLoop: vi.fn(),
}));
vi.mock("../src/approvals/service", () => ({ setPreviewMessageId: setPreviewMessageIdMock }));
vi.mock("../src/agent/usage", () => ({ checkBudget: checkBudgetMock }));
vi.mock("../src/feedback/service", () => ({ storeResponseSnapshot: storeResponseSnapshotMock }));

import { resetConversationSessions } from "../src/discord/conversation-session";
import { discordConversationSessions } from "../src/discord/session";
import { registerMessageCreate } from "../src/discord/events/message-create";

function makeMessage(content: string, id: string) {
  const reply = vi.fn().mockResolvedValue({ id: `bot-${id}` });
  return {
    id,
    content,
    createdAt: new Date(),
    guildId: "guild-1",
    channelId: "channel-1",
    author: { id: "user-1", bot: false },
    guild: {
      members: { me: "bot-member" },
    },
    member: {
      roles: { cache: new Map([["role-1", true]]) },
    },
    attachments: new Map(),
    channel: {
      type: ChannelType.GuildText,
      isDMBased: () => false,
      permissionsFor: () => ({ has: () => true }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ id: "follow-up" }),
    },
    reply,
  };
}

describe("message create conversation sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationSessions();
    discordConversationSessions.closeSession("guild-1", "channel-1", "user-1");
    getGuildSettingsMock.mockResolvedValue({ enabled: true, allChannels: true });
    isAiChannelAllowedMock.mockResolvedValue(true);
    hasAllowedRoleMock.mockResolvedValue(true);
    checkBudgetMock.mockResolvedValue({ ok: true });
    runAgentMock.mockResolvedValue({ finalResponse: "câu trả lời", intent: "chat" });
  });

  afterEach(() => {
    resetConversationSessions();
    discordConversationSessions.closeSession("guild-1", "channel-1", "user-1");
  });

  it("continues a same-user channel session without another bot mention", async () => {
    let handler: ((message: ReturnType<typeof makeMessage>) => Promise<void>) | undefined;
    const client = {
      user: { id: "123456789012345678" },
      on: vi.fn((_event, cb) => {
        handler = cb;
      }),
    };
    registerMessageCreate(client as never);

    const first = makeMessage("<@123456789012345678> câu đầu", "m1");
    const followUp = makeMessage("ý mình là đoạn vừa rồi", "m2");

    await handler?.(first);
    await handler?.(followUp);

    expect(runAgentMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ input: "câu đầu", requestId: expect.any(String) }),
    );
    expect(runAgentMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: "ý mình là đoạn vừa rồi", requestId: expect.any(String) }),
    );
    expect(followUp.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("<@user-1> câu trả lời"),
        allowedMentions: { users: ["user-1"], repliedUser: true },
      }),
    );
    expect(writeAuditMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "ai.responded",
        details: expect.objectContaining({ via: "session" }),
      }),
    );
  });
});
