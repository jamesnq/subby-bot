type DailyBucket = {
  day: string;
  count: number;
};

const buckets = new Map<string, DailyBucket>();

export type CodeAccessLimitResult =
  | { ok: true }
  | { ok: false; reason: string };

export function hitCodeAccessDailyLimit(input: {
  guildId: string;
  userId: string;
  userLimit: number;
  guildLimit: number;
  now?: Date;
}): CodeAccessLimitResult {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const guildKey = `guild:${input.guildId}`;
  const userKey = `user:${input.guildId}:${input.userId}`;

  const guildCount = readCount(guildKey, day);
  if (guildCount >= input.guildLimit) {
    return { ok: false, reason: "Server đã đạt giới hạn verify `/code` trong ngày." };
  }

  const userCount = readCount(userKey, day);
  if (userCount >= input.userLimit) {
    return { ok: false, reason: "Bạn đã đạt giới hạn verify `/code` trong ngày. Thử lại ngày mai hoặc liên hệ admin." };
  }

  writeCount(guildKey, day, guildCount + 1);
  writeCount(userKey, day, userCount + 1);
  return { ok: true };
}

export function resetCodeAccessLimits(): void {
  buckets.clear();
}

function readCount(key: string, day: string): number {
  const bucket = buckets.get(key);
  if (!bucket || bucket.day !== day) return 0;
  return bucket.count;
}

function writeCount(key: string, day: string, count: number): void {
  buckets.set(key, { day, count });
}
