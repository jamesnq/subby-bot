import { config } from "@config";
import {
  DEFAULT_SESSION_LOCK_TTL_MS,
} from "./session/types";
import { MemoryConversationSessionStore } from "./session/memory-store";

export type {
  ConversationSession,
  ConversationSessionStore,
  FinishTurnInput,
  IncomingSessionMessage,
  SessionDecision,
  SessionDecisionReason,
  SessionStoreOptions,
} from "./session/types";
export {
  DEFAULT_MAX_SESSION_TURNS,
  DEFAULT_SESSION_LOCK_TTL_MS,
  DEFAULT_SESSION_TTL_MS,
} from "./session/types";
export { stripLeadingBotMention } from "./session/mention";
export { MemoryConversationSessionStore } from "./session/memory-store";

export const discordConversationSessions = new MemoryConversationSessionStore({
  ttlMs: config.CONVERSATION_SESSION_TIMEOUT_MINUTES * 60 * 1000,
  lockTtlMs: Math.max(config.LLM_TIMEOUT_MS * 2, DEFAULT_SESSION_LOCK_TTL_MS),
});
