export const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_SESSION_LOCK_TTL_MS = 30 * 1000;
export const DEFAULT_MAX_SESSION_TURNS = 8;

export type SessionDecisionReason =
  | "bot_message"
  | "missing_guild"
  | "empty_prompt"
  | "foreign_mention"
  | "no_active_session"
  | "session_busy"
  | "max_turns_reached";

export type SessionDecision =
  | {
      shouldHandle: false;
      reason: SessionDecisionReason;
      mentioned: boolean;
      prompt: string;
      session?: ConversationSession;
    }
  | {
      shouldHandle: true;
      kind: "start" | "continue";
      mentioned: boolean;
      replyToBot: boolean;
      prompt: string;
      session: ConversationSession;
    };

export type IncomingSessionMessage = {
  messageId: string;
  guildId?: string | null;
  channelId: string;
  authorId: string;
  authorIsBot?: boolean;
  content: string;
  referencedMessageId?: string | null;
  createdAt?: Date | number;
};

export type ConversationSession = {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  openedByMessageId: string;
  lastUserMessageId: string;
  lastBotMessageId?: string;
  lastRequestId?: string;
  openedAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  turnCount: number;
  lockedAt?: Date;
};

export type SessionStoreOptions = {
  ttlMs?: number;
  lockTtlMs?: number;
  maxTurns?: number;
};

export type FinishTurnInput = {
  requestId?: string;
  botMessageId?: string;
  now?: Date | number;
  close?: boolean;
};

export interface ConversationSessionStore {
  resolveMessage(message: IncomingSessionMessage, botUserId: string): SessionDecision;
  finishTurn(sessionId: string, input?: FinishTurnInput): ConversationSession | undefined;
  abandonTurn(sessionId: string): ConversationSession | undefined;
  getSession(guildId: string, channelId: string, userId: string, nowInput?: Date | number): ConversationSession | undefined;
  closeSession(guildId: string, channelId: string, userId: string): void;
  sweepExpired(nowInput?: Date | number): number;
  size(): number;
}
