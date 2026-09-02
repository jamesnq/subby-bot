import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseCategoryRef, listCategoryChildren, describeChannel } from "../context";
import { authFail } from "@shared/errors";

const schema = z.object({
  categoryRef: z.string().min(1).describe("Category cần xóa"),
});

export const deleteCategoryTool = defineTool({
  name: "delete_category",
  description:
    "Xóa một category. Các channel con KHÔNG bị xóa mà sẽ tách rời (orphan)",
  risk: "destructive",
  group: "category",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  authorize(ctx) {
    if (!ctx.settings.destructiveEnabled) {
      return authFail("Server đã tắt các hành động destructive");
    }
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return authFail("Bạn cần quyền Manage Channels để xóa category qua bot");
    }
    return { ok: true };
  },
  async preview(ctx, input) {
    const lines: string[] = [
      "⚠️ Hành động này KHÔNG THỂ hoàn tác.",
      "Các channel con sẽ trở thành channel rời (không bị xóa):",
    ];
    const resolved = parseCategoryRef(ctx.guild, input.categoryRef);
    if (resolved.ok) {
      const children = listCategoryChildren(ctx.guild, resolved.value.id);
      lines.push(
        children.length > 0
          ? children.map((c) => `• ${describeChannel(c)} (<#${c.id}>)`).join("\n")
          : "(category này không có channel con)",
      );
    }
    return { title: `Xóa category ${input.categoryRef}`, lines };
  },
  async execute(ctx, input) {
    const resolved = parseCategoryRef(ctx.guild, input.categoryRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const name = resolved.value.name;
    await resolved.value.delete(
      `AI delete_category by ${ctx.member.user.username} (${ctx.requestId})`,
    );
    return { deletedCategoryId: resolved.value.id, deletedName: name };
  },
});
