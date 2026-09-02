import { eq, sql } from "drizzle-orm";
import type { Client, TextChannel } from "discord.js";
import { db } from "../database/db";
import { scheduledJobs, type CodeAccessFeedbackRequestRow } from "../database/schema";
import { logger } from "@shared/logger";
import { purgeExpiredSteamCodeCache } from "../code-access/steam-code-cache";
import { sweepCodeAccessData } from "../code-access/retention";
import { sweepMissingFeedback, FEEDBACK_PENALTY_DAYS } from "../code-access/feedback-penalty";
import { discordConversationSessions } from "../discord/session";
import { sweepExpiredRateLimits } from "../policies/rate-limit";

const POLL_INTERVAL_MS = 30_000;
/** Cached Steam Guard codes are short-lived; sweeping every 5 min is ample. */
const CODE_CACHE_SWEEP_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

let timer: NodeJS.Timeout | null = null;
let codeCacheSweepTimer: NodeJS.Timeout | null = null;
let processing = false;

export function startScheduler(client: Client): void {
  if (timer) return;
  timer = setInterval(() => {
    void processDueJobs(client);
  }, POLL_INTERVAL_MS);

  codeCacheSweepTimer = setInterval(() => {
    void sweepProcessCaches(client);
  }, CODE_CACHE_SWEEP_INTERVAL_MS);

  logger.info("scheduler started");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (codeCacheSweepTimer) clearInterval(codeCacheSweepTimer);
  codeCacheSweepTimer = null;
}

async function processDueJobs(client: Client): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    // Claim jobs atomically để tránh gửi trùng khi tick chồng nhau / chạy nhiều instance
    let due;
    try {
      due = await db.execute(sql`
        UPDATE scheduled_jobs SET status = 'processing'
        WHERE id IN (
          SELECT id FROM scheduled_jobs
          WHERE status = 'pending' AND run_at < now()
          ORDER BY run_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `);
    } catch (err) {
      logger.error({ err }, "scheduler claim query failed");
      return;
    }

    const rows = (due.rows ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const job = {
        id: String(row.id),
        channelId: String(row.channel_id),
        jobType: String(row.job_type),
        payload: (row.payload ?? {}) as { content?: string; mentionsAllowed?: boolean },
      };
      await deliverJob(client, job.id, job.channelId, job.jobType, job.payload);
    }
  } finally {
    processing = false;
  }
}

async function deliverJob(
  client: Client,
  jobId: string,
  channelId: string,
  jobType: string,
  payload: { content?: string; mentionsAllowed?: boolean },
): Promise<void> {
  try {
    if (jobType !== "send_message") {
      throw new Error(`Loại job không hỗ trợ: ${jobType}`);
    }
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.isDMBased() || !("send" in channel)) {
      throw new Error("Channel không tồn tại hoặc không gửi được");
    }
    const content = String(payload.content ?? "");
    await (channel as TextChannel).send({
      content,
      allowedMentions: { parse: payload.mentionsAllowed ? ["users", "roles"] : [] },
    });
    await db
      .update(scheduledJobs)
      .set({ status: "sent", sentAt: new Date(), error: null })
      .where(eq(scheduledJobs.id, jobId));
    logger.info({ jobId }, "scheduled message sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Lỗi tạm thời (network/Discord 5xx) → retry với backoff thay vì fail vĩnh viễn
    const attemptsRow = await db
      .select({ n: scheduledJobs.attempts })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, jobId))
      .catch(() => [{ n: MAX_ATTEMPTS }]);
    const attempts = (attemptsRow[0]?.n ?? 0) + 1;

    if (attempts < MAX_ATTEMPTS && isTransient(message)) {
      const backoffMs = 60_000 * attempts;
      await db
        .update(scheduledJobs)
        .set({
          status: "pending",
          attempts,
          error: message,
          runAt: new Date(Date.now() + backoffMs),
        })
        .where(eq(scheduledJobs.id, jobId));
      logger.warn({ err, jobId, attempts }, "scheduled job transient failure - will retry");
      return;
    }

    await db
      .update(scheduledJobs)
      .set({ status: "failed", attempts, error: message })
      .where(eq(scheduledJobs.id, jobId));
    logger.error({ err, jobId }, "scheduled job failed");
  }
}

function isTransient(message: string): boolean {
  return (
    /network|timeout|fetch failed|5\d\d|rate limit/i.test(message) ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT")
  );
}

async function sweepProcessCaches(client: Client): Promise<void> {
  await purgeExpiredSteamCodeCache().catch((err) => {
    logger.warn({ err }, "Steam code cache sweep failed");
  });
  const codeAccessSweep = await sweepCodeAccessData().catch((err) => {
    logger.warn({ err }, "code access retention sweep failed");
    return null;
  });
  if (codeAccessSweep) await notifyExpiredEscalations(client, codeAccessSweep.expiredEscalations);
  const feedbackSweep = await sweepMissingFeedback().catch((err) => {
    logger.warn({ err }, "code access feedback sweep failed");
    return null;
  });
  if (feedbackSweep) await notifyFeedbackSweep(client, feedbackSweep);
  const removedSessions = await discordConversationSessions.sweepExpired().catch((err) => {
    logger.warn({ err }, "conversation session sweep failed");
    return 0;
  });
  if (removedSessions > 0) {
    logger.debug({ removedSessions }, "expired conversation sessions swept");
  }
  await sweepExpiredRateLimits().catch((err) => {
    logger.warn({ err }, "rate limit sweep failed");
  });
}

async function notifyExpiredEscalations(client: Client, rows: Array<{ userId: string; payloadJson: Record<string, unknown> }>): Promise<void> {
  for (const row of rows) {
    const content = "⏰ Yêu cầu `/code` đã hết hạn sau 48 giờ mà chưa được xử lý. Hãy chụp lại ảnh hoặc liên hệ fanpage.";
    const user = await client.users.fetch(row.userId).catch(() => null);
    if (await user?.send({ content, allowedMentions: { parse: [] } }).then(() => true).catch(() => false)) continue;
    const channelId = typeof row.payloadJson.channelId === "string" ? row.payloadJson.channelId : undefined;
    if (!channelId) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && !channel.isDMBased() && "send" in channel) {
      await channel.send({ content: `<@${row.userId}> ${content}`, allowedMentions: { users: [row.userId] } }).catch(() => undefined);
    }
  }
}

async function notifyFeedbackSweep(client: Client, result: {
  reminders: CodeAccessFeedbackRequestRow[];
  penalties: Array<{ row: CodeAccessFeedbackRequestRow; bannedUntil: Date }>;
}): Promise<void> {
  for (const row of result.reminders) {
    await sendToThreadThenDm(
      client,
      row.threadId,
      row.userId,
      `<@${row.userId}> ⏰ Nhắc nhẹ: bấm 👍/👎 ở tin nhắn phía trên giúp mình với — sắp hết hạn, bỏ qua sẽ tạm khoá \`/code signup\`/\`/code request\` ${FEEDBACK_PENALTY_DAYS} ngày.`,
    );
  }
  for (const { row, bannedUntil } of result.penalties) {
    await sendToThreadThenDm(
      client,
      row.threadId,
      row.userId,
      `<@${row.userId}> ⛔ Bạn chưa xác nhận feedback (👍/👎) nên \`/code signup\` và \`/code request\` đã bị tạm khoá tới ${bannedUntil.toISOString().slice(0, 10)} (${FEEDBACK_PENALTY_DAYS} ngày). Bấm 👍/👎 ở tin nhắn phía trên bất cứ lúc nào để gỡ khoá ngay, không cần chờ hết hạn.`,
    );
  }
}

/** Thread first (keeps context, works even locked+archived since the bot owns the thread), DM as fallback. */
async function sendToThreadThenDm(client: Client, threadId: string, userId: string, content: string): Promise<void> {
  const channel = await client.channels.fetch(threadId).catch(() => null);
  if (channel && !channel.isDMBased() && "send" in channel) {
    const sent = await channel.send({ content, allowedMentions: { users: [userId] } }).then(() => true).catch(() => false);
    if (sent) return;
  }
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
}
