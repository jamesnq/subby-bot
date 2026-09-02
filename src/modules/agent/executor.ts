import { ZodError } from "zod";
import {
  getTool,
  maxRisk,
  type ToolContext,
} from "../tools/registry";
import "../tools";
import { writeAudit } from "../database/audit";
import { logger } from "@shared/logger";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../policies/guard";
import { incToolExecution } from "../observability/metrics";
import type { PlannedCall } from "../policies/types";
import type { AuthResult } from "@shared/errors";
import {
  claimExecution,
  closeExecutionFailure,
  closeExecutionSuccess,
  findPriorSuccess,
  idempotencyKeyFor,
} from "./executor/idempotency";
import { COMPENSATABLE_TOOLS, compensateCompletedTools } from "./executor/compensation";
import { summarize } from "./executor/summarize";
import type { ExecutionContext, ExecutionResult, StepOutcome } from "./executor/types";

export type {
  ExecutionContext,
  ExecutionResult,
  StepOutcome,
} from "./executor/types";

export async function executePlan(
  ctx: ExecutionContext,
  calls: PlannedCall[],
): Promise<ExecutionResult> {
  const outcomes: StepOutcome[] = [];
  const completedCompensatable: { name: string; result: Record<string, unknown> }[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const key = idempotencyKeyFor(ctx.requestId, i);
    const tool = getTool(call.name);

    if (!tool) {
      outcomes.push({ index: i, toolName: call.name, risk: "read", status: "failed", summary: "", error: `Tool không tồn tại: ${call.name}` });
      break;
    }

    let input: unknown;
    try {
      input = tool.schema.parse(call.args);
    } catch (err) {
      const detail = err instanceof ZodError ? err.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") : String(err);
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "failed", summary: "", error: `Tham số không hợp lệ: ${detail}` });
      break;
    }

    if (tool.risk !== "read" && !isAdminMember(ctx.member)) {
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "denied", summary: "", error: ADMIN_DENY_MESSAGE });
      await writeAudit({
        requestId: ctx.requestId,
        guildId: ctx.guild.id,
        actorId: ctx.member.id,
        action: `tool.${call.name}.denied`,
        targetType: call.name,
        status: "denied",
        details: { args: call.args, reason: "not_admin" },
      });
      break;
    }

    const auth: AuthResult = tool.authorize
      ? await tool.authorize(toolCtxOf(ctx), input)
      : { ok: true };
    if (!auth.ok) {
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "denied", summary: "", error: auth.reason });
      await writeAudit({
        requestId: ctx.requestId,
        guildId: ctx.guild.id,
        actorId: ctx.member.id,
        action: `tool.${call.name}.denied`,
        targetType: call.name,
        status: "denied",
        details: { args: call.args, reason: auth.reason },
      });
      break;
    }

    const me = ctx.guild.members.me;
    if (!me || !me.permissions.has(tool.requiredBotPermissions)) {
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "denied", summary: "", error: `Bot thiếu quyền Discord cho tool ${call.name}` });
      break;
    }

    try {
      const prior = await findPriorSuccess(key);
      if (prior) {
        outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "skipped_idempotent", summary: summarize(call.name, prior) });
        continue;
      }

      const executionId = await claimExecution({
        requestId: ctx.requestId,
        stepIndex: i,
        guildId: ctx.guild.id,
        requesterId: ctx.member.id,
        toolName: call.name,
        risk: tool.risk,
        argsJson: call.args,
        idempotencyKey: key,
      });

      if (!executionId) {
        const raced = await findPriorSuccess(key);
        outcomes.push({
          index: i,
          toolName: call.name,
          risk: tool.risk,
          status: "skipped_idempotent",
          summary: raced
            ? summarize(call.name, raced)
            : "Bước này đang được một tiến trình khác thực hiện",
        });
        continue;
      }

      const result = await tool.execute(toolCtxOf(ctx), input);
      await closeExecutionSuccess(executionId, result);

      if (COMPENSATABLE_TOOLS.has(call.name)) {
        completedCompensatable.push({ name: call.name, result });
      }

      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "success", summary: summarize(call.name, result) });
      incToolExecution();
      await writeAudit({
        requestId: ctx.requestId,
        guildId: ctx.guild.id,
        actorId: ctx.member.id,
        action: `tool.${call.name}.executed`,
        targetType: call.name,
        details: { step: i },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, requestId: ctx.requestId, step: i, tool: call.name }, "tool execution failed");
      await closeExecutionFailure(key, message);
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "failed", summary: "", error: message });
      break;
    }
  }

  const failed = outcomes.some((o) => o.status === "failed" || o.status === "denied");
  const compensated = failed && completedCompensatable.length > 0
    ? await compensateCompletedTools(ctx, completedCompensatable)
    : [];

  return {
    outcomes,
    allSuccess: outcomes.every((o) => o.status === "success" || o.status === "skipped_idempotent"),
    risk: maxRisk(outcomes.map((o) => o.risk)),
    compensated,
  };
}

type ToolCtx = ToolContext;

function toolCtxOf(ctx: ExecutionContext): ToolCtx {
  return {
    requestId: ctx.requestId,
    guild: ctx.guild,
    member: ctx.member,
    channel: ctx.channel,
    allowMentions: ctx.allowMentions,
    settings: ctx.settings,
  };
}
