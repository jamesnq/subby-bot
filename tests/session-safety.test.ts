import { ChannelType, PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  assertSessionActor,
  canAutoReplyInChannel,
  isBotLoopRiskMessage,
  safeSessionAllowedMentions,
  sameSessionActor,
  sessionRateLimitKey,
  type SessionIdentity,
} from "../src/discord/session-safety";

function channel(type: ChannelType, allowed: bigint[]) {
  const allowedSet = new Set(allowed);
  return {
    type,
    isDMBased: () => false,
    permissionsFor: () => ({
      has: (permission: bigint) => allowedSet.has(permission),
    }),
  };
}

describe("session safety guards", () => {
  it("disables every mention class and reply pings for auto-replies", () => {
    expect(safeSessionAllowedMentions()).toEqual({ parse: [], repliedUser: false });
  });

  it("treats bot, webhook, system, and self-authored messages as loop risks", () => {
    expect(isBotLoopRiskMessage({ author: { bot: true } })).toBe(true);
    expect(isBotLoopRiskMessage({ webhookId: "webhook-1" })).toBe(true);
    expect(isBotLoopRiskMessage({ system: true })).toBe(true);
    expect(isBotLoopRiskMessage({ author: { id: "bot-1" } }, "bot-1")).toBe(true);
    expect(isBotLoopRiskMessage({ author: { id: "user-1", bot: false } }, "bot-1")).toBe(false);
  });

  it("scopes rate-limit buckets to guild, channel, and user", () => {
    const base: SessionIdentity = { guildId: "g1", channelId: "c1", userId: "u1" };

    expect(sessionRateLimitKey(base)).toBe("ai-session:g1:c1:u1");
    expect(sessionRateLimitKey({ ...base, userId: "u2" })).not.toBe(sessionRateLimitKey(base));
    expect(sessionRateLimitKey({ ...base, channelId: "c2" })).not.toBe(sessionRateLimitKey(base));
    expect(sessionRateLimitKey({ ...base, guildId: "g2" })).not.toBe(sessionRateLimitKey(base));
  });

  it("requires exact guild/channel/user ownership before reusing session state", () => {
    const owner: SessionIdentity = { guildId: "g1", channelId: "c1", userId: "u1" };

    expect(sameSessionActor(owner, { guildId: "g1", channelId: "c1", userId: "u1" })).toBe(true);
    expect(assertSessionActor(owner, { guildId: "g1", channelId: "c1", userId: "u2" }).ok).toBe(false);
    expect(assertSessionActor(owner, { guildId: "g1", channelId: "c2", userId: "u1" }).ok).toBe(false);
    expect(assertSessionActor(owner, { guildId: "g2", channelId: "c1", userId: "u1" }).ok).toBe(false);
  });

  it("requires bot view/send/history permissions in text channels", () => {
    const ok = channel(ChannelType.GuildText, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ]);
    const missingSend = channel(ChannelType.GuildText, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ]);

    expect(canAutoReplyInChannel(ok, "bot").ok).toBe(true);
    expect(canAutoReplyInChannel(missingSend, "bot").ok).toBe(false);
  });

  it("requires thread send permission for thread auto-replies", () => {
    const ok = channel(ChannelType.PublicThread, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ReadMessageHistory,
    ]);
    const missingThreadSend = channel(ChannelType.PublicThread, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ]);

    expect(canAutoReplyInChannel(ok, "bot").ok).toBe(true);
    expect(canAutoReplyInChannel(missingThreadSend, "bot").ok).toBe(false);
  });

  it("blocks DMs and unsupported channel types", () => {
    expect(canAutoReplyInChannel({ isDMBased: () => true }, "bot").ok).toBe(false);
    expect(canAutoReplyInChannel(channel(ChannelType.GuildVoice, []), "bot").ok).toBe(false);
  });
});
