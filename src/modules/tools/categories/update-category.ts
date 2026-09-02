import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseCategoryRef } from "../context";

const schema = z.object({
  categoryRef: z.string().min(1).describe("Category cần đổi tên"),
  name: z.string().min(1).max(100),
});

export const updateCategoryTool = defineTool({
  name: "update_category",
  description: "Đổi tên một category",
  risk: "write",
  group: "category",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  async preview(ctx, input) {
    const resolved = parseCategoryRef(ctx.guild, input.categoryRef);
    const target = resolved.ok ? resolved.value.name : input.categoryRef;
    return {
      title: "Đổi tên category",
      lines: [`${target} → ${input.name}`],
    };
  },
  async execute(ctx, input) {
    const resolved = parseCategoryRef(ctx.guild, input.categoryRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const oldName = resolved.value.name;
    await resolved.value.edit({
      name: input.name,
      reason: `AI update_category by ${ctx.member.user.username} (${ctx.requestId})`,
    });
    return { categoryId: resolved.value.id, oldName, newName: input.name };
  },
});
