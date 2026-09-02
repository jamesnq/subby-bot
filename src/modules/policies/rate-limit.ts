import { sql } from "drizzle-orm";
import { db } from "../database/db";

const WINDOW_MS = 60_000;

export interface RateLimitStore {
  hit(key: string, limitPerMinute: number): boolean | Promise<boolean>;
  reset(): void | Promise<void>;
  sweepExpired?(now?: Date): void | Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, number[]>();

  hit(key: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const list = (this.buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

    if (list.length >= limitPerMinute) {
      this.write(key, list);
      return false;
    }

    list.push(now);
    this.write(key, list);
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }

  sweepExpired(now = new Date()): void {
    const cutoff = now.getTime() - WINDOW_MS;
    for (const [key, list] of this.buckets) {
      this.write(key, list.filter((hitAt) => hitAt >= cutoff));
    }
  }

  private write(key: string, list: number[]): void {
    if (list.length === 0) {
      this.buckets.delete(key);
    } else {
      this.buckets.set(key, list);
    }
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  async hit(key: string, limitPerMinute: number): Promise<boolean> {
    const result = await db.execute(sql`
      WITH locked AS (
        SELECT pg_advisory_xact_lock(hashtext(${key}))
      ), pruned AS (
        DELETE FROM rate_limit_hits
        WHERE "key" = ${key}
          AND hit_at < now() - interval '60 seconds'
      ), current_count AS (
        SELECT count(*)::int AS count
        FROM rate_limit_hits, locked
        WHERE "key" = ${key}
      ), inserted AS (
        INSERT INTO rate_limit_hits ("key")
        SELECT ${key}
        WHERE (SELECT count FROM current_count) < ${limitPerMinute}
        RETURNING id
      )
      SELECT EXISTS(SELECT 1 FROM inserted) AS allowed
    `);
    return Boolean((result.rows?.[0] as { allowed?: unknown } | undefined)?.allowed);
  }

  async reset(): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limit_hits`);
  }

  async sweepExpired(): Promise<void> {
    await db.execute(sql`
      DELETE FROM rate_limit_hits
      WHERE hit_at < now() - interval '60 seconds'
    `);
  }
}

const memoryStore = new MemoryRateLimitStore();
let store: RateLimitStore = memoryStore;

export function configureRateLimitStore(nextStore: RateLimitStore): void {
  store = nextStore;
}

export function useMemoryRateLimitStore(): void {
  store = memoryStore;
}

/**
 * Always async, even against the memory store: `await` on a plain boolean
 * resolves immediately, so callers can stay uniform regardless of which
 * store STATE_BACKEND selects.
 */
export async function hitRateLimit(key: string, limitPerMinute: number): Promise<boolean> {
  return store.hit(key, limitPerMinute);
}

export async function resetRateLimits(): Promise<void> {
  await store.reset();
}

export async function sweepExpiredRateLimits(): Promise<void> {
  await store.sweepExpired?.();
}
