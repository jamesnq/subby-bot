import { sql } from "drizzle-orm";
import { db } from "../database/db";

type DailyBucket = {
  day: string;
  count: number;
};

export type CodeAccessLimitResult =
  | { ok: true }
  | { ok: false; reason: string };

export type CodeAccessDailyLimitInput = {
  guildId: string;
  userId: string;
  userLimit: number;
  guildLimit: number;
  now?: Date;
  scope?: "signup" | "request";
};

export interface CodeAccessDailyLimitStore {
  hit(input: CodeAccessDailyLimitInput): CodeAccessLimitResult | Promise<CodeAccessLimitResult>;
  reset(): void | Promise<void>;
}

const GUILD_LIMIT_MESSAGE = "Server đã đạt giới hạn verify `/code` trong ngày.";
const USER_LIMIT_MESSAGE = "Bạn đã đạt giới hạn verify `/code` trong ngày. Thử lại ngày mai hoặc liên hệ admin.";

export class MemoryCodeAccessDailyLimitStore implements CodeAccessDailyLimitStore {
  private readonly buckets = new Map<string, DailyBucket>();

  hit(input: CodeAccessDailyLimitInput): CodeAccessLimitResult {
    const day = dayOf(input.now);
    const scope = input.scope ?? "signup";
    const guildKey = `guild:${scope}:${input.guildId}`;
    const userKey = `user:${scope}:${input.guildId}:${input.userId}`;

    const guildCount = this.readCount(guildKey, day);
    if (guildCount >= input.guildLimit) return { ok: false, reason: GUILD_LIMIT_MESSAGE };

    const userCount = this.readCount(userKey, day);
    if (userCount >= input.userLimit) return { ok: false, reason: USER_LIMIT_MESSAGE };

    this.writeCount(guildKey, day, guildCount + 1);
    this.writeCount(userKey, day, userCount + 1);
    return { ok: true };
  }

  reset(): void {
    this.buckets.clear();
  }

  private readCount(key: string, day: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.day !== day) return 0;
    return bucket.count;
  }

  private writeCount(key: string, day: string, count: number): void {
    this.buckets.set(key, { day, count });
  }
}

export class PostgresCodeAccessDailyLimitStore implements CodeAccessDailyLimitStore {
  async hit(input: CodeAccessDailyLimitInput): Promise<CodeAccessLimitResult> {
    const day = dayOf(input.now);
    const scope = input.scope ?? "signup";
    const guildKey = `guild:${scope}:${input.guildId}`;
    const userKey = `user:${scope}:${input.guildId}:${input.userId}`;
    const result = await db.execute(sql`
      WITH locked AS (
        SELECT
          pg_advisory_xact_lock(hashtext(${guildKey})),
          pg_advisory_xact_lock(hashtext(${userKey}))
      ), counts AS (
        SELECT
          COALESCE((SELECT count FROM daily_limit_counts WHERE scope_key = ${guildKey} AND day = ${day}::date), 0)::int AS guild_count,
          COALESCE((SELECT count FROM daily_limit_counts WHERE scope_key = ${userKey} AND day = ${day}::date), 0)::int AS user_count
        FROM locked
      ), guild_upsert AS (
        INSERT INTO daily_limit_counts (scope_key, day, count)
        SELECT ${guildKey}, ${day}::date, 1
        FROM counts
        WHERE guild_count < ${input.guildLimit} AND user_count < ${input.userLimit}
        ON CONFLICT (scope_key, day) DO UPDATE
        SET count = daily_limit_counts.count + 1
        RETURNING count
      ), user_upsert AS (
        INSERT INTO daily_limit_counts (scope_key, day, count)
        SELECT ${userKey}, ${day}::date, 1
        FROM counts
        WHERE guild_count < ${input.guildLimit} AND user_count < ${input.userLimit}
        ON CONFLICT (scope_key, day) DO UPDATE
        SET count = daily_limit_counts.count + 1
        RETURNING count
      )
      SELECT
        CASE
          WHEN guild_count >= ${input.guildLimit} THEN 'guild'
          WHEN user_count >= ${input.userLimit} THEN 'user'
          ELSE 'ok'
        END AS status
      FROM counts
    `);
    const status = String((result.rows?.[0] as { status?: unknown } | undefined)?.status ?? "ok");
    if (status === "guild") return { ok: false, reason: GUILD_LIMIT_MESSAGE };
    if (status === "user") return { ok: false, reason: USER_LIMIT_MESSAGE };
    return { ok: true };
  }

  async reset(): Promise<void> {
    await db.execute(sql`DELETE FROM daily_limit_counts`);
  }
}

const memoryStore = new MemoryCodeAccessDailyLimitStore();
let store: CodeAccessDailyLimitStore = memoryStore;

export function configureCodeAccessDailyLimitStore(nextStore: CodeAccessDailyLimitStore): void {
  store = nextStore;
}

export function useMemoryCodeAccessDailyLimitStore(): void {
  store = memoryStore;
}

/**
 * Always async, even against the memory store: `await` on a plain value
 * resolves immediately, so callers can stay uniform regardless of which
 * store STATE_BACKEND selects.
 */
export async function hitCodeAccessDailyLimit(
  input: CodeAccessDailyLimitInput,
): Promise<CodeAccessLimitResult> {
  return store.hit(input);
}

export async function resetCodeAccessLimits(): Promise<void> {
  await store.reset();
}

function dayOf(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}
