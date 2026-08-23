import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { resolveSendTarget, mentionGuard } from "./target";

const fieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().default(false),
});

const schema = z
  .object({
    title: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    footerText: z.string().max(2048).optional(),
    fields: z.array(fieldSchema).max(10).optional(),
    channelRef: z.string().optional(),
  })
  .refine(
    (v) =>
      (v.description?.length ?? 0) +
        (v.footerText?.length ?? 0) +
        (v.fields?.reduce((s, f) => s + f.name.length + f.value.length, 0) ?? 0) +
        v.title.length <
      5900,
    { message: "Tổng độ dài embed vượt giới hạn 6000 ký tự của Discord" },
  );

export const sendEmbedTool = defineTool({
  name: "send_embed",
  description:
    "Gửi tin nhắn dạng embed (thẻ đẹp): tiêu đề, mô tả, màu, footer và tối đa 10 fields",
  risk: "write",
  group: "message",
  schema,
  requiredBotPermissions: [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ViewChannel,
  ],
  authorize: (ctx, input) => mentionGuard(ctx, `${input.title}${input.description ?? ""}`),
  preview: (_ctx, input) => {
    const descPreview = input.description
      ? input.description.slice(0, 400) +
        (input.description.length > 400 ? `… *(hiển thị 400/${input.description.length} ký tự)*`
          : "")
      : null;
    return {
      title: `Embed: ${input.title}`,
      lines: [
        descPreview ?? "(không có mô tả)",
        input.colorHex ? `Màu: ${input.colorHex}` : null,
        input.footerText ? `Footer: ${input.footerText}` : null,
        `${input.fields?.length ?? 0} fields`,
        input.channelRef ? `Đến: ${input.channelRef}` : "Đến: channel hiện tại",
      ].filter((l): l is string => Boolean(l)),
    };
  },
  async execute(ctx, input) {
    const target = resolveSendTarget(ctx, input.channelRef);
    if (!target.ok) throw new Error(target.reason);

    const embed = new EmbedBuilder()
      .setTitle(input.title)
      .setColor(input.colorHex ? parseInt(input.colorHex.slice(1), 16) : 0x5865f2);
    if (input.description) embed.setDescription(input.description);
    if (input.footerText) embed.setFooter({ text: input.footerText });
    if (input.fields?.length) {
      embed.addFields(input.fields.map((f) => ({ ...f })));
    }

    const msg = await target.value.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return { messageId: msg.id, channelId: msg.channel.id };
  },
});
