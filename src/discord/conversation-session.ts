import type { TextBasedChannel } from "discord.js";
import { config } from "../config";
import { logger } from "../observability/logger";

type SessionKey = `${string}:${string}:${string}`;

type ActiveSession = {
  guildId: string;
  channelId: string;
  userId: string;
  timer: NodeJS.Timeout | null;
  expiresAt: number;
  onExpire?: () => void;
};

export type SessionIdentity = {
  guildId: string;
  channelId: string;
  userId: string;
};

const sessions = new Map<SessionKey, ActiveSession>();

type SendableChannel = TextBasedChannel & {
  send(options: {
    content: string;
    allowedMentions: { users: string[]; repliedUser: false };
  }): Promise<unknown>;
};

function keyOf({ guildId, channelId, userId }: SessionIdentity): SessionKey {
  return `${guildId}:${channelId}:${userId}`;
}

function isSendableChannel(channel: TextBasedChannel): channel is SendableChannel {
  return "send" in channel && typeof channel.send === "function";
}

export function resetConversationSessions(): void {
  for (const session of sessions.values()) {
    if (session.timer) clearTimeout(session.timer);
  }
  sessions.clear();
}

export function isConversationSessionActive(identity: SessionIdentity): boolean {
  const session = sessions.get(keyOf(identity));
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    endConversationSession(identity);
    return false;
  }
  return true;
}

export function beginConversationTurn(identity: SessionIdentity): void {
  if (!config.CONVERSATION_SESSION_ENABLED) return;
  const key = keyOf(identity);
  const existing = sessions.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  sessions.set(key, {
    ...identity,
    timer: null,
    expiresAt: Date.now() + config.CONVERSATION_SESSION_TIMEOUT_MINUTES * 60_000,
  });
}

export function scheduleConversationFollowUp(
  identity: SessionIdentity,
  channel: TextBasedChannel,
  onExpire?: () => void,
): void {
  if (!config.CONVERSATION_SESSION_ENABLED) return;
  const key = keyOf(identity);
  const session = sessions.get(key) ?? {
    ...identity,
    timer: null,
    expiresAt: Date.now(),
  };
  if (session.timer) clearTimeout(session.timer);

  const timeoutMs = config.CONVERSATION_SESSION_TIMEOUT_MINUTES * 60_000;
  session.expiresAt = Date.now() + timeoutMs;
  session.timer = setTimeout(() => {
    void sendFinalFollowUp(identity, channel);
  }, timeoutMs);
  session.onExpire = onExpire;
  sessions.set(key, session);
}

export function endConversationSession(identity: SessionIdentity): void {
  const key = keyOf(identity);
  const session = sessions.get(key);
  if (session?.timer) clearTimeout(session.timer);
  sessions.delete(key);
}

async function sendFinalFollowUp(
  identity: SessionIdentity,
  channel: TextBasedChannel,
): Promise<void> {
  const key = keyOf(identity);
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.onExpire?.();

  if (!config.CONVERSATION_SESSION_FOLLOWUP_ENABLED) return;
  if (!isSendableChannel(channel)) return;
  try {
    await channel.send({
      content: `<@${identity.userId}> bạn còn cần mình hỗ trợ thêm gì không? Nếu không thì mình kết thúc phiên ở đây nhé.`,
      allowedMentions: { users: [identity.userId], repliedUser: false },
    });
  } catch (err) {
    logger.warn({ err, ...identity }, "conversation follow-up failed");
  }
}
