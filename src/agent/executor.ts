import { and, eq } from "drizzle-orm";
import type { Guild, GuildMember } from "discord.js";
import { ZodError } from "zod";
import {
  getTool,
  maxRisk,
  type RiskLevel,
  type ToolContext,
  type SendableGuildChannel,
} from "../tools/registry";
import "../tools";
import { toolExecutions, type GuildSettingsRow } from "../database/schema";
import { db } from "../database/db";
import { writeAudit } from "../database/audit";
import { logger } from "../observability/logger";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../discord/permissions/guard";
import { incToolExecution } from "../observability/metrics";
import type { PlannedCall } from "../policies/types";
import type { AuthResult } from "../shared/errors";

export type ExecutionContext = {
  requestId: string;
  guild: Guild;
  member: GuildMember;
  channel: SendableGuildChannel;
  settings: GuildSettingsRow;
  allowMentions: boolean;
};

export type StepOutcome = {
  index: number;
  toolName: string;
  risk: RiskLevel;
  status: "success" | "failed" | "denied" | "skipped_idempotent";
  summary: string;
  error?: string;
};

export type ExecutionResult = {
  outcomes: StepOutcome[];
  allSuccess: boolean;
  risk: RiskLevel;
  compensated: string[];
};

const COMPENSATABLE_TOOLS = new Set(["create_channel", "create_category"]);

function idempotencyKeyFor(requestId: string, index: number): string {
  return `${requestId}:${index}`;
}

async function findPriorSuccess(
  key: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.select()
    .from(toolExecutions)
    .where(and(eq(toolExecutions.idempotencyKey, key), eq(toolExecutions.status, "success")))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].resultJson ?? {};
}

function summarize(toolName: string, result: Record<string, unknown>): string {
  switch (toolName) {
    case "list_guild_structure": {
      const cats = (result.categories as { name: string; children: string[] }[]) ?? [];
      const ungrouped = (result.ungrouped as string[]) ?? [];
      const total = cats.reduce((s, c) => s + c.children.length, 0) + ungrouped.length;
      return `Server có ${cats.length} categories, ${total} channels`;
    }
    case "search_knowledge":
      return `Tìm thấy ${result.resultCount ?? 0} kết quả kiến thức`;
    case "create_channel":
      return `Đã tạo channel ${result.mention} (${result.name})`;
    case "update_channel":
      return `Đã cập nhật channel ${result.mention}`;
    case "delete_channel":
      return `Đã xóa channel ${result.deletedDescription}`;
    case "create_category":
      return `Đã tạo category ${result.name}`;
    case "update_category":
      return `Đổi tên category ${result.oldName} → ${result.newName}`;
    case "delete_category":
      return `Đã xóa category ${result.deletedName} (channel con được giữ lại)`;
    case "send_message":
      return `Đã gửi tin nhắn vào <#${result.channelId}>`;
    case "reply_message":
      return `Đã reply tin nhắn trong <#${result.channelId}>`;
    case "send_embed":
      return `Đã gửi embed vào <#${result.channelId}>`;
    case "schedule_message":
      return `⏰ Đã lên lịch gửi lúc ${result.runAt}`;
    default:
      return `Hoàn tất ${toolName}`;
  }
}

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

      const result = await tool.execute(toolCtxOf(ctx), input);

      await db.insert(toolExecutions).values({
        requestId: ctx.requestId,
        stepIndex: i,
        guildId: ctx.guild.id,
        requesterId: ctx.member.id,
        toolName: call.name,
        risk: tool.risk,
        argsJson: call.args,
        resultJson: result,
        status: "success",
        idempotencyKey: key,
        finishedAt: new Date(),
      });

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
      await db.insert(toolExecutions).values({
        requestId: ctx.requestId,
        stepIndex: i,
        guildId: ctx.guild.id,
        requesterId: ctx.member.id,
        toolName: call.name,
        risk: tool.risk,
        argsJson: call.args,
        error: message,
        status: "failed",
        idempotencyKey: key,
        finishedAt: new Date(),
      }).catch(() => undefined);
      outcomes.push({ index: i, toolName: call.name, risk: tool.risk, status: "failed", summary: "", error: message });
      break;
    }
  }

  const compensated: string[] = [];
  const failed = outcomes.some((o) => o.status === "failed" || o.status === "denied");
  if (failed && completedCompensatable.length > 0) {
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
  }

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


