import { ChannelType, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseChannelRef } from "../context";

const schema = z.object({
  channelRef: z
    .string()
    .min(1)
    .describe("Channel cần xem: id, <#id> hoặc tên (#general)"),
});

export const getChannelTool = defineTool({
  name: "get_channel",
  description: "Xem chi tiết một channel: topic, slowmode, category cha, loại kênh",
  risk: "read",
  group: "read",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ViewChannel],
  preview: (ctx, input) => ({
    title: `Xem channel ${input.channelRef}`,
    lines: [`Server: ${ctx.guild.name}`],
  }),
  async execute(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const ch = resolved.value;
    return {
      channelId: ch.id,
      name: ch.name,
      type: ch.type,
      mention: `<#${ch.id}>`,
      parentId: "parentId" in ch ? ch.parentId : undefined,
      topic: "topic" in ch ? ch.topic : undefined,
      slowmodeSeconds:
        "rateLimitPerUser" in ch && typeof ch.rateLimitPerUser === "number"
          ? ch.rateLimitPerUser
          : 0,
      nsfw: "nsfw" in ch ? ch.nsfw : false,
      position: ch.rawPosition,
      createdAt: ch.createdAt?.toISOString(),
    };
  },
});
