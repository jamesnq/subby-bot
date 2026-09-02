import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseCategoryRef } from "../context";

const schema = z.object({
  topic: z.string().min(3).max(200).describe("Vấn đề cần hỗ trợ"),
});

export const createTicketTool = defineTool({
  name: "create_ticket",
  description:
    "Tạo channel ticket riêng tư: chỉ người tạo, mod role (nếu cấu hình) và bot xem được",
  risk: "write",
  group: "channel",
  schema,
  requiredBotPermissions: [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ],
  async preview(ctx, input) {
    const category = ctx.settings.supportCategoryId
      ? ctx.guild.channels.cache.get(ctx.settings.supportCategoryId)?.name
      : undefined;
    return {
      title: "Tạo ticket",
      lines: [
        `Chủ đề: ${input.topic}`,
        `Nơi đặt: ${category ? `category ${category}` : "không có category"}`,
        "Quyền truy cập: người tạo + mod role + bot",
      ],
    };
  },
  async execute(ctx, input) {
    const safeName = `${input.topic
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)}-${ctx.member.user.username.slice(0, 12).toLowerCase()}`.slice(0, 90);

    let parentId: string | undefined;
    if (ctx.settings.supportCategoryId) {
      const cat = parseCategoryRef(ctx.guild, ctx.settings.supportCategoryId);
      if (cat.ok) parentId = cat.value.id;
    }

    const overwrites: {
      id: string;
      allow?: bigint[];
      deny?: bigint[];
    }[] = [
      {
        id: ctx.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: ctx.member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: ctx.guild.members.me!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];

    if (ctx.settings.modRoleId) {
      overwrites.push({
        id: ctx.settings.modRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const created = await ctx.guild.channels.create({
      name: safeName,
      type: ChannelType.GuildText,
      parent: parentId,
      topic: `[ticket] ${input.topic} (mở bởi ${ctx.member.user.tag}, ${ctx.requestId})`,
      permissionOverwrites: overwrites as never,
      reason: `AI create_ticket (${ctx.requestId})`,
    });

    await created.send(
      `🎫 Ticket của <@${ctx.member.id}> về **${input.topic}**.\nMod sẽ vào xử lý sớm. Dùng \`/ai\` tại đây nếu cần tra cứu thông tin.`,
    );

    return {
      channelId: created.id,
      mention: `<#${created.id}>`,
      name: created.name,
      topic: input.topic,
    };
  },
});
