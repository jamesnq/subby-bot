import { eq, sql } from "drizzle-orm";
import type { Client, TextChannel } from "discord.js";
import { db } from "../database/db";
import { scheduledJobs } from "../database/schema";
import { logger } from "../observability/logger";

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

let timer: NodeJS.Timeout | null = null;
let processing = false;

export function startScheduler(client: Client): void {
  if (timer) return;
  timer = setInterval(() => {
    void processDueJobs(client);
  }, POLL_INTERVAL_MS);
  logger.info("scheduler started");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
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
