import crypto from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "../../database/db";
import { codeAccessOcrCache } from "../../database/schema";
import { parseOcrResult } from "./parsing";
import { OCR_PROMPT_VERSION, type CodeAccessOcrResult } from "./types";

const OCR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function buildOcrCacheKey(imageHashes: string[], promptVersion = OCR_PROMPT_VERSION): string {
  return crypto.createHash("sha256").update(`${imageHashes.join(":")}:${promptVersion}`).digest("hex");
}

export async function getCachedOcrResult(key: string, now = new Date()): Promise<CodeAccessOcrResult | null> {
  const rows = await db.select().from(codeAccessOcrCache).where(eq(codeAccessOcrCache.sha256Key, key)).limit(1);
  const row = rows[0];
  if (!row || now.getTime() - row.createdAt.getTime() > OCR_CACHE_TTL_MS) return null;
  return parseOcrResult(JSON.stringify(row.resultJson));
}

export async function putCachedOcrResult(key: string, result: CodeAccessOcrResult, now = new Date()): Promise<void> {
  await db.insert(codeAccessOcrCache).values({
    sha256Key: key,
    resultJson: result,
    createdAt: now,
  }).onConflictDoUpdate({
    target: codeAccessOcrCache.sha256Key,
    set: { resultJson: result, createdAt: now },
  });
}

export async function purgeExpiredOcrCache(now = new Date()): Promise<number> {
  const removed = await db.delete(codeAccessOcrCache)
    .where(lt(codeAccessOcrCache.createdAt, new Date(now.getTime() - OCR_CACHE_TTL_MS)))
    .returning({ key: codeAccessOcrCache.sha256Key });
  return removed.length;
}
