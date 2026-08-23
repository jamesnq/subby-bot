import { conversationMessages } from "../../database/schema";
import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import type { AgentState } from "../state";

export async function auditNode(state: AgentState): Promise<Partial<AgentState>> {
  await writeAudit({
    requestId: state.requestId,
    guildId: state.guildId,
    actorId: state.userId,
    action: "ai.request.completed",
    targetType: "request",
    status: state.error ? "failed" : "ok",
    details: {
      intent: state.intent ?? "unknown",
      risk: state.riskLevel,
      approval: state.approval,
      steps: (state.proposedCalls ?? []).map((c) => c.name),
    },
  });

  try {
    await db.insert(conversationMessages).values([
      {
        guildId: state.guildId,
        channelId: state.channelId,
        userId: state.userId,
        role: "user",
        content: state.input,
      },
      ...(state.finalResponse
        ? [
            {
              guildId: state.guildId,
              channelId: state.channelId,
              userId: state.userId,
              role: "assistant" as const,
              content: state.finalResponse.slice(0, 4000),
              citations:
                state.retrievedContext && state.retrievedContext.length > 0
                  ? [...new Set(state.retrievedContext.map((c) => c.documentId))]
                  : null,
            },
          ]
        : []),
    ]);
  } catch {
  }

  return {};
}

