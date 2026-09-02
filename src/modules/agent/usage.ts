import { and, eq, sql } from "drizzle-orm";
import { db } from "../database/db";
import { usageDaily } from "../database/schema";
import { config } from "@config";
import { logger } from "@shared/logger";
import { incLlmCall } from "../observability/metrics";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

type UsageMetadataLike = {
  input_tokens?: number;
  output_tokens?: number;
};

export async function recordLlmUsage(
  guildId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  try {
    await db
      .insert(usageDaily)
      .values({
        guildId,
        day: todayUtc(),
        llmCalls: 1,
        promptTokens: Math.max(0, Math.round(promptTokens)),
        completionTokens: Math.max(0, Math.round(completionTokens)),
      })
      .onConflictDoUpdate({
        target: [usageDaily.guildId, usageDaily.day],
        set: {
          llmCalls: sql`${usageDaily.llmCalls} + 1`,
          promptTokens: sql`${usageDaily.promptTokens} + ${Math.max(0, Math.round(promptTokens))}`,
          completionTokens: sql`${usageDaily.completionTokens} + ${Math.max(0, Math.round(completionTokens))}`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err }, "failed to record llm usage");
  }
}

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export type UsageRowLike = {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
} | null;

export function evaluateBudget(
  row: UsageRowLike,
  limits: { calls: number; tokens: number },
): BudgetCheck {
  if (!row) return { ok: true };
  const totalTokens = Math.max(0, row.promptTokens) + Math.max(0, row.completionTokens);
  if (row.llmCalls >= limits.calls) {
    return { ok: false, reason: `Server đã dùng hết hạn mức ${limits.calls} lượt gọi AI hôm nay.` };
  }
  if (totalTokens >= limits.tokens) {
    return { ok: false, reason: `Server đã dùng hết hạn mức ~${limits.tokens} tokens AI hôm nay.` };
  }
  return { ok: true };
}

export function checkBudget(guildId: string): Promise<BudgetCheck> {
  return (async () => {
    try {
      const rows = await db
        .select()
        .from(usageDaily)
        .where(and(eq(usageDaily.guildId, guildId), eq(usageDaily.day, todayUtc())))
        .limit(1);

      return evaluateBudget(
        rows[0] ?? null,
        { calls: config.GUILD_DAILY_LLM_CALLS_LIMIT, tokens: config.GUILD_DAILY_TOKEN_LIMIT },
      );
    } catch {
      return { ok: true };
    }
  })();
}
