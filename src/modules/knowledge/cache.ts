import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../database/db";
import { faqCache } from "../database/schema";
import { config } from "@config";

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

export function queryHashOf(question: string): string {
  return createHash("sha256").update(normalizeQuestion(question)).digest("hex");
}

export function roleScopeHash(roleIds: string[]): string {
  const sorted = [...roleIds].sort().join(",");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 64);
}

export type CachedAnswer = {
  answer: string;
  citations: string[];
};

export async function lookupCachedAnswer(
  guildId: string,
  question: string,
  memberRoleIds: string[],
): Promise<CachedAnswer | null> {
  try {
    const rows = await db
      .select()
      .from(faqCache)
      .where(
        and(
          eq(faqCache.guildId, guildId),
          eq(faqCache.queryHash, queryHashOf(question)),
          eq(faqCache.roleScopeHash, roleScopeHash(memberRoleIds)),
          gt(faqCache.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    await db
      .update(faqCache)
      .set({ hits: sql`${faqCache.hits} + 1` })
      .where(eq(faqCache.id, rows[0].id));
    return { answer: rows[0].answer, citations: rows[0].citations ?? [] };
  } catch {
    return null;
  }
}

export async function storeCachedAnswer(
  guildId: string,
  question: string,
  answer: string,
  citations: string[],
  memberRoleIds: string[],
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + config.KNOWLEDGE_CACHE_TTL_HOURS * 3600_000);
    await db
      .insert(faqCache)
      .values({
        guildId,
        queryHash: queryHashOf(question),
        question: normalizeQuestion(question).slice(0, 2000),
        answer: answer.slice(0, 3800),
        citations,
        roleScopeHash: roleScopeHash(memberRoleIds),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [faqCache.guildId, faqCache.queryHash, faqCache.roleScopeHash],
        set: {
          answer: answer.slice(0, 3800),
          citations,
          createdAt: new Date(),
          expiresAt,
        },
      });
  } catch {
    // cache write is best-effort
  }
}

export async function deleteCachedAnswer(
  guildId: string,
  question: string,
  memberRoleIds: string[],
): Promise<boolean> {
  try {
    const deleted = await db
      .delete(faqCache)
      .where(
        and(
          eq(faqCache.guildId, guildId),
          eq(faqCache.queryHash, queryHashOf(question)),
          eq(faqCache.roleScopeHash, roleScopeHash(memberRoleIds)),
        ),
      )
      .returning({ id: faqCache.id });
    return deleted.length > 0;
  } catch {
    return false;
  }
}

export async function deleteCachedAnswerByKey(
  guildId: string,
  queryHash: string,
  scopeHash: string,
): Promise<boolean> {
  try {
    const deleted = await db
      .delete(faqCache)
      .where(
        and(
          eq(faqCache.guildId, guildId),
          eq(faqCache.queryHash, queryHash),
          eq(faqCache.roleScopeHash, scopeHash),
        ),
      )
      .returning({ id: faqCache.id });
    return deleted.length > 0;
  } catch {
    return false;
  }
}
