import { ChannelType, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseChannelRef, parseCategoryRef } from "../context";

const schema = z.object({
  channelRef: z.string().min(1).describe("Channel cần đồng bộ quyền với category cha"),
});

export const syncCategoryPermissionsTool = defineTool({
  name: "sync_category_permissions",
  description:
    "Đồng bộ permission overwrites của channel theo category cha (giống nút Sync Permissions của Discord)",
  risk: "write",
  group: "channel",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels],
  async preview(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    let parentLine = "(channel không có category cha)";
    if (resolved.ok && resolved.value.parentId) {
      const cat = ctx.guild.channels.cache.get(resolved.value.parentId);
      if (cat) parentLine = `Category cha: ${cat.name}`;
    }
    return {
      title: "Sync quyền với category",
      lines: [
        `Channel: ${resolved.ok ? `<#${resolved.value.id}>` : input.channelRef}`,
        parentLine,
        "Toàn bộ override riêng của channel sẽ bị thay bằng quyền của category",
      ],
    };
  },
  async execute(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const ch = resolved.value;
    if (ch.type === ChannelType.GuildCategory) {
      throw new Error("Channel mục tiêu là category, không thể tự sync");
    }
    if (!ch.parentId) throw new Error("Channel không có category cha để đồng bộ");

    const cat = await (async () => {
      const ref = parseCategoryRef(ctx.guild, ch.parentId!);
      return ref.ok ? ref.value : null;
    })();
    if (!cat) throw new Error("Category cha không tồn tại");

    await ch.lockPermissions();

    return {
      channelId: ch.id,
      syncedWithCategoryId: cat.id,
      syncedWithCategoryName: cat.name,
    };
  },
});
