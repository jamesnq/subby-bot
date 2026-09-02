import { sanitizeKnowledgeText } from "@shared/sanitize";
import type { AgentState } from "../state";

const MENTION_RE = /<@!?(\d{17,20})>/g;

export async function normalizeInput(state: AgentState): Promise<Partial<AgentState>> {
  let input = state.input.trim();
  input = input.replace(MENTION_RE, "").trim();
  input = input.replace(/\s+/g, " ");
  return { input: sanitizeKnowledgeText(input) };
}
