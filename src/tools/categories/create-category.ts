import { ChannelType, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";

const schema = z.object({
  name: z.string().min(1).max(100),
});

export const createCategoryTool = defineTool({
  name: "create_category",
  description: "Tạo category mới (nhóm channel)",
  risk: "write",
  group: "category",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  async preview(_ctx, input) {
    return {
      title: `Tạo category ${input.name}`,
      lines: ["Category mới sẽ xuất hiện ở cuối danh sách."],
    };
  },
  async execute(ctx, input) {
    const created = await ctx.guild.channels.create({
      name: input.name,
      type: ChannelType.GuildCategory,
      reason: `AI create_category by ${ctx.member.user.username} (${ctx.requestId})`,
    });
    return { categoryId: created.id, name: created.name };
  },
});
