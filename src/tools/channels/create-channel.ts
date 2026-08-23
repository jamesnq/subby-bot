import { ChannelType, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseCategoryRef } from "../context";

const schema = z.object({
  name: z.string().min(1).max(100).describe("Tên channel mới"),
  type: z
    .enum(["text", "voice", "announcement", "forum"])
    .default("text")
    .describe("Loại channel"),
  categoryRef: z.string().optional().describe("Category cha (id hoặc tên)"),
  topic: z.string().max(1024).optional(),
  nsfw: z.boolean().default(false),
  slowmodeSeconds: z.number().int().min(0).max(21600).default(0),
});

export const createChannelTool = defineTool({
  name: "create_channel",
  description:
    "Tạo channel mới trong server (text/voice/announcement/forum), có thể đặt vào category",
  risk: "write",
  group: "channel",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  async preview(_ctx, input) {
    return {
      title: `Tạo channel #${input.name}`,
      lines: [
        `Loại: ${input.type}`,
        input.categoryRef ? `Category: ${input.categoryRef}` : "Không có category cha",
        input.topic ? `Topic: ${input.topic}` : null,
        `Slowmode: ${input.slowmodeSeconds}s`,
      ].filter((l): l is string => Boolean(l)),
    };
  },
  async execute(ctx, input) {
    const typeMap = {
      text: ChannelType.GuildText,
      voice: ChannelType.GuildVoice,
      announcement: ChannelType.GuildAnnouncement,
      forum: ChannelType.GuildForum,
    } as const;

    let parentId: string | undefined;
    if (input.categoryRef) {
      const cat = parseCategoryRef(ctx.guild, input.categoryRef);
      if (!cat.ok) throw new Error(cat.reason);
      parentId = cat.value.id;
    }

    const created = await ctx.guild.channels.create({
      name: input.name,
      type: typeMap[input.type ?? "text"],
      parent: parentId,
      topic: input.topic,
      nsfw: input.nsfw,
      rateLimitPerUser: input.slowmodeSeconds,
      reason: `AI create_channel by ${ctx.member.user.username} (${ctx.requestId})`,
    });

    return {
      channelId: created.id,
      mention: `<#${created.id}>`,
      name: created.name,
      type: input.type,
      categoryId: parentId,
    };
  },
});
