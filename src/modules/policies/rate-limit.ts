const buckets = new Map<string, number[]>();

const WINDOW_MS = 60_000;

export function hitRateLimit(key: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (list.length >= limitPerMinute) {
    buckets.set(key, list);
    return false;
  }

  list.push(now);
  buckets.set(key, list);
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
