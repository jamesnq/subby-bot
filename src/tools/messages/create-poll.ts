import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { resolveSendTarget } from "../messages/target";

const schema = z.object({
  question: z.string().min(1).max(300).describe("Câu hỏi poll"),
  options: z
    .array(z.string().min(1).max(100))
    .min(2)
    .max(10)
    .describe("2-10 lựa chọn"),
  allowMultiselect: z.boolean().default(false),
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(24)
    .describe("Thời gian poll (giờ, tối đa 7 ngày)"),
  channelRef: z.string().optional(),
});

export const createPollTool = defineTool({
  name: "create_poll",
  description:
    "Tạo poll (bình chọn) chính thức của Discord với 2-10 lựa chọn và thời hạn",
  risk: "write",
  group: "message",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  preview: (_ctx, input) => ({
    title: `Poll: ${input.question}`,
    lines: [
      ...input.options.map((o, i) => `${i + 1}. ${o}`),
      `Chọn nhiều: ${input.allowMultiselect ? "có" : "không"} • Hạn: ${input.durationHours}h`,
      input.channelRef ? `Đến: ${input.channelRef}` : "Đến: channel hiện tại",
    ],
  }),
  async execute(ctx, input) {
    const target = resolveSendTarget(ctx, input.channelRef);
    if (!target.ok) throw new Error(target.reason);

    const msg = await target.value.send({
      poll: {
        question: { text: input.question },
        answers: input.options.map((text) => ({ text })),
        duration: input.durationHours,
        allowMultiselect: input.allowMultiselect,
      },
      allowedMentions: { parse: [] },
    });
    return {
      messageId: msg.id,
      channelId: msg.channel.id,
      url: msg.url,
      optionCount: input.options.length,
    };
  },
});
