import { and, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { toolExecutions } from "../../database/schema";
import type { RiskLevel } from "../../tools/registry";

export function idempotencyKeyFor(requestId: string, index: number): string {
  return `${requestId}:${index}`;
}

export async function findPriorSuccess(
  key: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.select()
    .from(toolExecutions)
    .where(and(eq(toolExecutions.idempotencyKey, key), eq(toolExecutions.status, "success")))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].resultJson ?? {};
}

export async function claimExecution(input: {
  requestId: string;
  stepIndex: number;
  guildId: string;
  requesterId: string;
  toolName: string;
  risk: RiskLevel;
  argsJson: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<string | null> {
  // The read before this helper is only a fast path. This insert remains the
  // atomic gate: whoever wins the unique idempotency key owns the side effect.
  const claim = await db
    .insert(toolExecutions)
    .values({
      requestId: input.requestId,
      stepIndex: input.stepIndex,
      guildId: input.guildId,
      requesterId: input.requesterId,
      toolName: input.toolName,
      risk: input.risk,
      argsJson: input.argsJson,
      status: "running",
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: toolExecutions.idempotencyKey })
    .returning({ id: toolExecutions.id });

  return claim[0]?.id ?? null;
}

export async function closeExecutionSuccess(
  executionId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(toolExecutions)
    .set({ resultJson: result, status: "success", finishedAt: new Date() })
    .where(eq(toolExecutions.id, executionId));
}

export async function closeExecutionFailure(
  idempotencyKey: string,
  message: string,
): Promise<void> {
  await db
    .update(toolExecutions)
    .set({ error: message, status: "failed", finishedAt: new Date() })
    .where(eq(toolExecutions.idempotencyKey, idempotencyKey))
    .catch(() => undefined);
}
