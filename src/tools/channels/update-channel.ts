import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseChannelRef, parseCategoryRef } from "../context";

const schema = z.object({
  channelRef: z.string().min(1).describe("Channel cần cập nhật"),
  name: z.string().min(1).max(100).optional(),
  topic: z.string().max(1024).optional(),
  slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
  nsfw: z.boolean().optional(),
  categoryRef: z
    .string()
    .nullable()
    .optional()
    .describe("Category mới; null để tách khỏi category"),
});

export const updateChannelTool = defineTool({
  name: "update_channel",
  description:
    "Cập nhật channel: đổi tên, topic, slowmode, nsfw hoặc di chuyển sang category khác",
  risk: "write",
  group: "channel",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels],
  async preview(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    const target = resolved.ok ? `${resolved.value.name} (<#${resolved.value.id}>)` : input.channelRef;
    const changes = [
      input.name !== undefined ? `Tên → ${input.name}` : null,
      input.topic !== undefined ? `Topic → ${input.topic || "(rỗng)"}` : null,
      input.slowmodeSeconds !== undefined ? `Slowmode → ${input.slowmodeSeconds}s` : null,
      input.nsfw !== undefined ? `NSFW → ${input.nsfw}` : null,
      input.categoryRef !== undefined
        ? `Category → ${input.categoryRef ?? "(không có)"}`
        : null,
    ].filter((l): l is string => Boolean(l));
    return {
      title: `Cập nhật channel ${target}`,
      lines: changes.length > 0 ? changes : ["Không có thay đổi nào"],
    };
  },
  async execute(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const ch = resolved.value;

    let parentId: string | null | undefined;
    if (input.categoryRef !== undefined) {
      if (input.categoryRef === null) {
        parentId = null;
      } else {
        const cat = parseCategoryRef(ctx.guild, input.categoryRef);
        if (!cat.ok) throw new Error(cat.reason);
        parentId = cat.value.id;
      }
    }

    await ch.edit({
      name: input.name,
      topic: "topic" in ch ? input.topic : undefined,
      rateLimitPerUser:
        "rateLimitPerUser" in ch ? input.slowmodeSeconds : undefined,
      nsfw: "nsfw" in ch ? input.nsfw : undefined,
      parent: parentId,
      lockPermissions: undefined,
      reason: `AI update_channel by ${ctx.member.user.username} (${ctx.requestId})`,
    });

    return {
      channelId: ch.id,
      mention: `<#${ch.id}>`,
      appliedChanges: {
        name: input.name,
        topic: input.topic,
        slowmodeSeconds: input.slowmodeSeconds,
        nsfw: input.nsfw,
        categoryId: parentId === undefined ? undefined : parentId,
      },
    };
  },
});
