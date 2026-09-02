import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentStateAnnotation, type AgentState } from "./state";
import { normalizeInput } from "./nodes/normalize-input";
import { deterministicGate, gateHasPlan } from "./nodes/deterministic-gate";
import { intentRouter } from "./nodes/intent-router";
import { retrieveKnowledge } from "./nodes/retrieve-knowledge";
import { planTools } from "./nodes/plan-tools";
import { validatePlan } from "./nodes/validate-plan";
import { requestApproval } from "./nodes/request-approval";
import { executeTools } from "./nodes/execute-tools";
import { composeResponse } from "./nodes/compose-response";
import { auditNode } from "./nodes/audit-node";
import { incRequest } from "../observability/metrics";

function routeAfterNormalize(state: AgentState): "fast" | "router" {
  return gateHasPlan(state) ? "fast" : "router";
}

function routeAfterIntent(state: AgentState): "knowledge" | "action" | "chat" {
  switch (state.intent) {
    case "knowledge":
      return "knowledge";
    case "action":
      return "action";
    default:
      return "chat";
  }
}

function routeAfterPlan(state: AgentState): "validate" | "compose" | "error" {
  if (state.error) return "error";
  return state.proposedCalls && state.proposedCalls.length > 0 ? "validate" : "compose";
}

function routeAfterValidate(state: AgentState): "approval" | "execute" | "compose" {
  if (state.error) return "compose";
  if (!state.proposedCalls || state.proposedCalls.length === 0) return "compose";
  if (state.approval === "pending") return "approval";
  return "execute";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("normalizeInput", normalizeInput)
  .addNode("deterministicGate", deterministicGate)
  .addNode("intentRouter", intentRouter)
  .addNode("retrieveKnowledge", retrieveKnowledge)
  .addNode("planTools", planTools)
  .addNode("validatePlan", validatePlan)
  .addNode("requestApproval", requestApproval)
  .addNode("executeTools", executeTools)
  .addNode("composeResponse", composeResponse)
  .addNode("auditNode", auditNode)

  .addEdge(START, "normalizeInput")
  .addEdge("normalizeInput", "deterministicGate")
  .addConditionalEdges("deterministicGate", routeAfterNormalize, {
    fast: "validatePlan",
    router: "intentRouter",
  })
  .addConditionalEdges("intentRouter", routeAfterIntent, {
    knowledge: "retrieveKnowledge",
    action: "planTools",
    chat: "composeResponse",
  })
  .addEdge("retrieveKnowledge", "composeResponse")
  .addConditionalEdges("planTools", routeAfterPlan, {
    validate: "validatePlan",
    compose: "composeResponse",
    error: "composeResponse",
  })
  .addConditionalEdges("validatePlan", routeAfterValidate, {
    approval: "requestApproval",
    execute: "executeTools",
    compose: "composeResponse",
  })
  .addEdge("requestApproval", "auditNode")
  .addEdge("executeTools", "composeResponse")
  .addEdge("composeResponse", "auditNode")
  .addEdge("auditNode", END);

export const agentGraph = workflow.compile();

export async function runAgent(
  initialState: Partial<AgentState> & {
    requestId: string;
    guildId: string;
    channelId: string;
    userId: string;
    input: string;
  },
): Promise<AgentState> {
  incRequest();
  const threadId = initialState.requestId;
  const result = await agentGraph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });
  return result as AgentState;
}
