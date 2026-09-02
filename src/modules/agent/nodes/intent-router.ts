import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getSmallModel, invokeTracked } from "../llm";
import { INTENT_SYSTEM_PROMPT } from "../prompts";
import { fallbackIntent } from "../routing";
import { logger } from "@shared/logger";
import type { AgentState, Intent } from "../state";

function parseLabel(text: string): Intent | null {
  const match = /^\s*(action|knowledge|chat)\b/.exec(text.toLowerCase().trim());
  return (match?.[1] as Intent | undefined) ?? null;
}

export async function intentRouter(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const response = await invokeTracked(getSmallModel(), state.guildId, [
      new SystemMessage(INTENT_SYSTEM_PROMPT),
      new HumanMessage(state.input),
    ]);
    const raw =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    const intent = parseLabel(raw) ?? fallbackIntent(state.input);
    return { intent };
  } catch (err) {
    logger.warn({ err }, "intent router LLM failed, using keyword fallback");
    return { intent: fallbackIntent(state.input) };
  }
}
