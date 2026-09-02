import { logger } from "@shared/logger";
import type { ExecutionContext } from "./types";

export const COMPENSATABLE_TOOLS = new Set(["create_channel", "create_category"]);

export async function compensateCompletedTools(
  ctx: ExecutionContext,
  completedCompensatable: { name: string; result: Record<string, unknown> }[],
): Promise<string[]> {
  const compensated: string[] = [];
  for (const done of [...completedCompensatable].reverse()) {
    try {
      if (done.name === "create_channel" && typeof done.result.channelId === "string") {
        const ch = ctx.guild.channels.cache.get(done.result.channelId);
        await ch?.delete(`AI compensation (${ctx.requestId})`);
        compensated.push(`rollback tạo #${String(done.result.name)}`);
      }
      if (done.name === "create_category" && typeof done.result.categoryId === "string") {
        const ch = ctx.guild.channels.cache.get(done.result.categoryId);
        await ch?.delete(`AI compensation (${ctx.requestId})`);
        compensated.push(`rollback category ${String(done.result.name)}`);
      }
    } catch (err) {
      logger.error({ err, requestId: ctx.requestId }, "compensation failed");
      compensated.push(`⚠️ rollback thất bại cho ${done.name}`);
    }
  }
  return compensated;
}
