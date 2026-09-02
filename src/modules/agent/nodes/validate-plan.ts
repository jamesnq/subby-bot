import { ZodError } from "zod";
import { config } from "@config";
import { getTool } from "../../tools/registry";
import { checkPlanPolicy } from "../../policies/policy";
import { maxRisk } from "../../tools/registry";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../../policies/guard";
import { buildExecutionContext } from "../context-builder";
import type { AgentState } from "../state";

export async function validatePlan(state: AgentState): Promise<Partial<AgentState>> {
  if (state.directAnswer) return {};

  const calls = state.proposedCalls ?? [];
  const policy = checkPlanPolicy(
    calls,
    {
      maxCalls: config.MAX_TOOL_CALLS_PER_REQUEST,
      maxResources: config.MAX_RESOURCES_PER_PLAN,
    },
    (name) => {
      const tool = getTool(name);
      return tool ? { risk: tool.risk } : undefined;
    },
  );

  if (!policy.ok) {
    if (policy.prohibited) {
      return { error: `🚫 Yêu cầu bị từ chối: ${policy.reason}` };
    }
    return { error: `⚠️ Kế hoạch không hợp lệ: ${policy.reason}` };
  }

  for (const call of calls) {
    const tool = getTool(call.name);
    if (!tool) continue;

    // Chặn tham số không có trong schema (model bịa tên arg) thay vì để zod nuốt im lặng
    const shape = (tool.schema as unknown as { shape?: Record<string, unknown> }).shape;
    if (shape) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      const unknownKeys = Object.keys(args).filter((k) => !(k in shape));
      if (unknownKeys.length > 0) {
        return {
          error: `⚠️ Tham số không hợp lệ cho ${call.name}: ${unknownKeys.join(", ")}`,
        };
      }
    }

    try {
      tool.schema.parse(call.args);
    } catch (err) {
      const detail =
        err instanceof ZodError
          ? err.issues.map((i) => `${call.name}.${i.path.join(".")}: ${i.message}`).join("; ")
          : String(err);
      return { error: `⚠️ Tham số không hợp lệ: ${detail}` };
    }
  }

  const risk = maxRisk(policy.risks);
  if (risk !== "read") {
    const ec = await buildExecutionContext(state).catch(() => null);
    if (!ec || !isAdminMember(ec.member)) {
      return { error: ADMIN_DENY_MESSAGE };
    }
  }
  return {
    riskLevel: risk,
    approval: risk === "read" ? "not_required" : "pending",
  };
}

export function planNeedsApproval(state: AgentState): boolean {
  return state.approval === "pending";
}
