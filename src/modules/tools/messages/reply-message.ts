import { PermissionFlagsBits, Message } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { resolveSendTarget, mentionGuard } from "./target";

const schema = z.object({
  messageId: z
    .string()
    .regex(/^\d{17,20}$/)
    .describe("ID tin nhắn cần trả lời"),
  content: z.string().min(1).max(2000),
  channelRef: z.string().optional(),
});

export const replyMessageTool = defineTool({
  name: "reply_message",
  description: "Trả lời (reply) một tin nhắn cụ thể bằng ID của nó",
  risk: "write",
  group: "message",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  authorize: (ctx, input) => mentionGuard(ctx, input.content),
  preview: (_ctx, input) => ({
    title: "Reply tin nhắn",
    lines: [`Message ID: ${input.messageId}`, `Nội dung: "${input.content.slice(0, 150)}…"`],
  }),
  async execute(ctx, input) {
    const target = resolveSendTarget(ctx, input.channelRef);
    if (!target.ok) throw new Error(target.reason);
    let original: Message;
    try {
      original = await target.value.messages.fetch(input.messageId);
    } catch {
      throw new Error(`Không tìm thấy tin nhắn ${input.messageId} trong <#${target.value.id}>`);
    }
    const reply = await original.reply({ content: input.content });
    return { messageId: reply.id, channelId: reply.channel.id, repliedTo: original.id };
  },
});
