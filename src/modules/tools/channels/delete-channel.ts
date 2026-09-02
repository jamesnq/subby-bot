import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseChannelRef, describeChannel } from "../context";
import { authFail } from "@shared/errors";

const schema = z.object({
  channelRef: z.string().min(1).describe("Channel cần xóa: id hoặc tên"),
});

export const deleteChannelTool = defineTool({
  name: "delete_channel",
  description: "Xóa vĩnh viễn một channel (không thể hoàn tác)",
  risk: "destructive",
  group: "channel",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  authorize(ctx) {
    if (!ctx.settings.destructiveEnabled) {
      return authFail("Server đã tắt các hành động destructive");
    }
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return authFail("Bạn cần quyền Manage Channels để xóa channel qua bot");
    }
    return { ok: true };
  },
  async preview(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    const lines = ["⚠️ Hành động này KHÔNG THỂ hoàn tác."];
    if (resolved.ok) {
      const ch = resolved.value;
      lines.unshift(`Channel sẽ bị xóa: ${describeChannel(ch)} (<#${ch.id}>)`);
    } else {
      lines.unshift(`Channel mục tiêu: ${input.channelRef}`);
    }
    return { title: "Xóa channel", lines };
  },
  async execute(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const ch = resolved.value;
    const info = describeChannel(ch);
    await ch.delete(`AI delete_channel by ${ctx.member.user.username} (${ctx.requestId})`);
    return { deletedChannelId: ch.id, deletedDescription: info };
  },
});
