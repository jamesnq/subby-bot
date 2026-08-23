import { fastPlan } from "../routing";
import type { AgentState } from "../state";

export async function deterministicGate(state: AgentState): Promise<Partial<AgentState>> {
  const calls = fastPlan(state.input);
  if (!calls) return {};
  return {
    intent: "action",
    proposedCalls: calls,
  };
}

export function gateHasPlan(state: AgentState): boolean {
  return Boolean(state.proposedCalls && state.proposedCalls.length > 0);
}
