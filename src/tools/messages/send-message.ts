import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { resolveSendTarget, mentionGuard, allowedMentionsFor } from "./target";

const schema = z.object({
  content: z.string().min(1).max(2000).describe("Nội dung tin nhắn"),
  channelRef: z.string().optional().describe("Channel đích, mặc định là channel hiện tại"),
});

export const sendMessageTool = defineTool({
  name: "send_message",
  description: "Gửi một tin nhắn văn bản vào channel (mặc định channel hiện tại)",
  risk: "write",
  group: "message",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  authorize: (ctx, input) => mentionGuard(ctx, input.content),
  async preview(_ctx, input) {
    return {
      title: "Gửi tin nhắn",
      lines: [
        input.channelRef ? `Đến: ${input.channelRef}` : "Đến: channel hiện tại",
        `Nội dung: "${input.content.slice(0, 200)}${input.content.length > 200 ? "…" : ""}"`,
      ],
    };
  },
  async execute(ctx, input) {
    const target = resolveSendTarget(ctx, input.channelRef);
    if (!target.ok) throw new Error(target.reason);
    const msg = await target.value.send({
      content: input.content,
      allowedMentions: allowedMentionsFor(ctx),
    });
    return { messageId: msg.id, channelId: msg.channel.id, url: msg.url };
  },
});

