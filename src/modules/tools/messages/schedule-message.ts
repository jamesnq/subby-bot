import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { resolveSendTarget, mentionGuard, allowedMentionsFor } from "./target";
import { scheduledJobs } from "../../database/schema";
import { db } from "../../database/db";

const schema = z
  .object({
    content: z.string().min(1).max(2000),
    channelRef: z.string().optional(),
    runAtIso: z.string().datetime({ offset: true }).optional().describe("Thời điểm gửi, ISO 8601"),
    inMinutes: z.number().int().min(1).max(43200).optional().describe("Gửi sau N phút"),
  })
  .refine((v) => Boolean(v.runAtIso) !== Boolean(v.inMinutes), {
    message: "Phải cung cấp runAtIso HOẶC inMinutes (chỉ một trong hai)",
  });

export const scheduleMessageTool = defineTool({
  name: "schedule_message",
  description:
    "Lên lịch gửi tin nhắn tại thời điểm cụ thể (runAtIso) hoặc sau N phút (inMinutes)",
  risk: "write",
  group: "schedule",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
  authorize: (ctx, input) => mentionGuard(ctx, input.content),
  preview: (_ctx, input) => {
    const runAtMs =
      input.runAtIso
        ? new Date(input.runAtIso).getTime()
        : Date.now() + (input.inMinutes ?? 0) * 60_000;
    const discordTime = `<t:${Math.floor(runAtMs / 1000)}:f> (<t:${Math.floor(runAtMs / 1000)}:R>)`;
    return {
      title: "Lên lịch tin nhắn",
      lines: [
        `Thời điểm: ${discordTime}`,
        `Đến: ${input.channelRef ?? "channel hiện tại"}`,
        `Nội dung: "${input.content.slice(0, 150)}${input.content.length > 150 ? "… *(bị cắt xem trước)*" : ""}"`,
      ],
    };
  },
  async execute(ctx, input) {
    const target = resolveSendTarget(ctx, input.channelRef);
    if (!target.ok) throw new Error(target.reason);
    const runAt = input.runAtIso ? new Date(input.runAtIso) : new Date(Date.now() + (input.inMinutes ?? 0) * 60_000);
    if (runAt.getTime() <= Date.now()) throw new Error("Thời gian lên lịch phải ở tương lai");

    const [job] = await db
      .insert(scheduledJobs)
      .values({
        guildId: ctx.guild.id,
        channelId: target.value.id,
        createdBy: ctx.member.id,
        jobType: "send_message",
        payload: { content: input.content, mentionsAllowed: allowedMentionsFor(ctx).parse.includes("roles") },
        status: "pending",
        runAt,
      })
      .returning();

    return {
      jobId: job.id,
      channelId: job.channelId,
      runAt: job.runAt.toISOString(),
      note: "Job đã được lưu và sẽ được gửi đúng giờ bởi scheduler",
    };
  },
});


