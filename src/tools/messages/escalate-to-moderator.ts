import { EmbedBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import type { SendableGuildChannel, ToolContext } from "../registry";
import { parseChannelRef } from "../context";
import { writeAudit } from "../../database/audit";

const schema = z.object({
  reason: z.string().min(3).max(500).describe("Lý do cần moderator xử lý"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  context: z.string().max(1000).optional().describe("Chi tiết bổ sung"),
});

function resolveModChannel(
  ctx: ToolContext,
): Promise<{ ok: true; channel: SendableGuildChannel } | { ok: false; reason: string }> {
  return (async () => {
    if (!ctx.settings.modLogChannelId) {
      return {
        ok: true as const,
        channel: ctx.channel,
      };
    }
    const ch = await ctx.guild.channels
      .fetch(ctx.settings.modLogChannelId)
      .catch(() => null);
    if (!ch || ch.isDMBased() || !("send" in ch) || ch.type !== ChannelType.GuildText) {
      return { ok: false as const, reason: "Mod-log channel không hợp lệ" };
    }
    return { ok: true as const, channel: ch as unknown as SendableGuildChannel };
  })();
}

export const escalateToModeratorTool = defineTool({
  name: "escalate_to_moderator",
  description:
    "Chuyển yêu cầu/vấn đề cho moderator: gửi cảnh báo vào mod-log kèm mention role mod",
  risk: "write",
  group: "message",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.SendMessages],
  async preview(ctx, input) {
    const target = await resolveModChannel(ctx);
    return {
      title: `Escalate cho moderator (${input.priority})`,
      lines: [
        target.ok ? `Gửi tới: <#${target.channel.id}>` : `Gửi tới: channel hiện tại`,
        `Lý do: ${input.reason}`,
        input.context ? `Bổ sung: ${input.context.slice(0, 200)}` : "",
      ].filter(Boolean),
    };
  },
  async execute(ctx, input) {
    const target = await resolveModChannel(ctx);
    if (!target.ok) throw new Error(target.reason);

    const embed = new EmbedBuilder()
      .setTitle(`🔔 Escalation: ưu tiên ${input.priority.toUpperCase()}`)
      .setDescription(input.reason)
      .setColor(input.priority === "high" ? 0xed4245 : input.priority === "low" ? 0x57f287 : 0xfee75c)
      .addFields(
        { name: "Người báo", value: `<@${ctx.member.id}>`, inline: true },
        { name: "Kênh gốc", value: `<#${ctx.channel.id}>`, inline: true },
        ...(input.context ? [{ name: "Chi tiết", value: input.context.slice(0, 1024) }] : []),
      )
      .setTimestamp();

    const modMentions = ctx.settings.modRoleId
      ? { content: `<@&${ctx.settings.modRoleId}>`, allowedMentions: { roles: [ctx.settings.modRoleId] } }
      : { content: undefined, allowedMentions: { parse: [] as [] } };

    await target.channel.send({
      ...modMentions,
      embeds: [embed],
    });

    await writeAudit({
      requestId: ctx.requestId,
      guildId: ctx.guild.id,
      actorId: ctx.member.id,
      action: "tool.escalate_to_moderator",
      targetType: "escalation",
      details: { priority: input.priority, reason: input.reason },
    });

    return {
      escalatedTo: target.channel.id,
      priority: input.priority,
      modRoleNotified: Boolean(ctx.settings.modRoleId),
    };
  },
});
