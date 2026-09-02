import { config } from "@config";
import {
  DEFAULT_SESSION_LOCK_TTL_MS,
  type ConversationSessionStore,
} from "./session/types";
import { MemoryConversationSessionStore } from "./session/memory-store";
import { PostgresConversationSessionStore } from "./session/postgres-store";

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
export { PostgresConversationSessionStore } from "./session/postgres-store";

/** Exported so bootstrap can build a PostgresConversationSessionStore with the same TTLs. */
export const sessionStoreOptions = {
  ttlMs: config.CONVERSATION_SESSION_TIMEOUT_MINUTES * 60 * 1000,
  lockTtlMs: Math.max(config.LLM_TIMEOUT_MS * 2, DEFAULT_SESSION_LOCK_TTL_MS),
};

let store: ConversationSessionStore = new MemoryConversationSessionStore(sessionStoreOptions);

export function configureConversationSessionStore(nextStore: ConversationSessionStore): void {
  store = nextStore;
}

export function useMemoryConversationSessionStore(): void {
  store = new MemoryConversationSessionStore(sessionStoreOptions);
}

/**
 * A stable facade, not the store itself - callers hold this reference for
 * the process lifetime (message-create.ts imports it once at module load),
 * so swapping stores must happen behind these delegating methods rather than
 * by reassigning the exported binding, which importers compiled to a local
 * destructure would never see change.
 */
export const discordConversationSessions: ConversationSessionStore = {
  resolveMessage: (message, botUserId) => store.resolveMessage(message, botUserId),
  finishTurn: (sessionId, input) => store.finishTurn(sessionId, input),
  abandonTurn: (sessionId) => store.abandonTurn(sessionId),
  getSession: (guildId, channelId, userId, nowInput) =>
    store.getSession(guildId, channelId, userId, nowInput),
  closeSession: (guildId, channelId, userId) => store.closeSession(guildId, channelId, userId),
  sweepExpired: (nowInput) => store.sweepExpired(nowInput),
  size: () => store.size(),
};
