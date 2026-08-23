import { ChannelType, PermissionFlagsBits, type NewsChannel, type TextChannel } from "discord.js";
import type { ToolContext } from "../registry";
import type { ResolveResult } from "../../shared/errors";
import { parseChannelRef } from "../context";

export type SendableChannel = TextChannel | NewsChannel;

export function resolveSendTarget(
  ctx: ToolContext,
  channelRef?: string,
): ResolveResult<SendableChannel> {
  const target = channelRef ?? `<#${ctx.channel.id}>`;
  const resolved = parseChannelRef(ctx.guild, target);
  if (!resolved.ok) return resolved;

  const ch = resolved.value;
  const sendable =
    ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement;
  if (!sendable) {
    return { ok: false, reason: `Channel <#${ch.id}> không hỗ trợ gửi tin nhắn văn bản` };
  }
  return { ok: true, value: ch as SendableChannel };
}

export function containsEveryoneOrHere(content: string): boolean {
  return /@(everyone|here)\b/i.test(content);
}

export function containsRolePing(content: string): boolean {
  return /<@&\d+>/.test(content);
}

export function needsExtendedMentionPermission(content: string): boolean {
  return containsEveryoneOrHere(content) || containsRolePing(content);
}

export function canUseExtendedMentions(ctx: ToolContext): boolean {
  return (
    ctx.settings.allowMentions ||
    ctx.member.permissions.has(PermissionFlagsBits.MentionEveryone)
  );
}

export function mentionGuard(ctx: ToolContext, content: string) {
  if (needsExtendedMentionPermission(content) && !canUseExtendedMentions(ctx)) {
    return {
      ok: false as const,
      reason:
        "Tin nhắn chứa @everyone/@here hoặc ping role nhưng bạn không có quyền Mention Everyone",
    };
  }
  return { ok: true as const };
}

export type AllowedMentions = { parse: ("users" | "roles" | "everyone")[] };

export function allowedMentionsFor(ctx: ToolContext): AllowedMentions {
  return canUseExtendedMentions(ctx)
    ? { parse: ["users", "roles", "everyone"] }
    : { parse: ["users"] };
}
