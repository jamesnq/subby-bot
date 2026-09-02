import { executePlan } from "../executor";
import type { StepSummary } from "../state";
import { writeAudit } from "../../database/audit";
import { buildExecutionContext } from "../context-builder";
import type { AgentState } from "../state";

export async function executeTools(state: AgentState): Promise<Partial<AgentState>> {
  const ec = await buildExecutionContext(state).catch((err) => {
    return null;
  });

  if (!ec) {
    return { error: "Không xác định được ngữ cảnh server để thực thi." };
  }

  const result = await executePlan(ec, state.proposedCalls ?? []);

  const summaries: StepSummary[] = result.outcomes.map((o) => ({
    index: o.index,
    toolName: o.toolName,
    risk: o.risk,
    status: o.status,
    summary: o.summary,
    error: o.error,
  }));

  await writeAudit({
    requestId: state.requestId,
    guildId: state.guildId,
    actorId: state.userId,
    action: "plan.executed",
    targetType: "plan",
    status: result.allSuccess ? "ok" : "failed",
    details: {
      risk: result.risk,
      steps: summaries.map((s) => ({ tool: s.toolName, status: s.status, error: s.error })),
      compensated: result.compensated,
    },
  });

  return {
    toolResults: summaries,
    approval: "approved",
  };
}
