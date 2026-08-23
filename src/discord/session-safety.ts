import { ChannelType, PermissionFlagsBits, type MessageMentionOptions } from "discord.js";

export type SessionIdentity = {
  guildId: string;
  channelId: string;
  userId: string;
};

export type SessionSafetyResult =
  | { ok: true }
  | { ok: false; reason: string };

type PermissionSetLike = {
  has(permission: bigint): boolean;
};

type SessionChannelLike = {
  type?: ChannelType;
  isDMBased?: () => boolean;
  permissionsFor?: (target: any) => PermissionSetLike | null;
};

type SessionMessageLike = {
  author?: {
    id?: string;
    bot?: boolean;
  };
  webhookId?: string | null;
  system?: boolean;
};

export function safeSessionAllowedMentions(): MessageMentionOptions {
  return { parse: [], repliedUser: false };
}

export function isBotLoopRiskMessage(message: SessionMessageLike, botUserId?: string): boolean {
  return Boolean(
    message.system ||
      message.webhookId ||
      message.author?.bot ||
      (botUserId && message.author?.id === botUserId),
  );
}

export function sessionRateLimitKey(identity: SessionIdentity): string {
  return `ai-session:${identity.guildId}:${identity.channelId}:${identity.userId}`;
}

export function sameSessionActor(owner: SessionIdentity, actor: SessionIdentity): boolean {
  return (
    owner.guildId === actor.guildId &&
    owner.channelId === actor.channelId &&
    owner.userId === actor.userId
  );
}

export function assertSessionActor(owner: SessionIdentity, actor: SessionIdentity): SessionSafetyResult {
  if (sameSessionActor(owner, actor)) return { ok: true };
  return { ok: false, reason: "Session does not belong to this guild/channel/user" };
}

export function canAutoReplyInChannel(
  channel: SessionChannelLike,
  botMemberOrId: unknown,
): SessionSafetyResult {
  if (!botMemberOrId) {
    return { ok: false, reason: "Cannot resolve bot guild member" };
  }

  if (channel.isDMBased?.()) {
    return { ok: false, reason: "Auto-reply sessions are not allowed in DMs" };
  }

  if (!isAutoReplyChannelType(channel.type)) {
    return { ok: false, reason: "Channel type does not support auto-reply sessions" };
  }

  const permissions = channel.permissionsFor?.(botMemberOrId);
  if (!permissions) {
    return { ok: false, reason: "Cannot resolve bot channel permissions" };
  }

  const required = requiredAutoReplyPermissions(channel.type);
  const missing = required.filter((permission) => !permissions.has(permission));
  if (missing.length > 0) {
    return { ok: false, reason: "Bot is missing channel permissions for auto-reply" };
  }

  return { ok: true };
}

function isAutoReplyChannelType(type: ChannelType | undefined): boolean {
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildAnnouncement ||
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread
  );
}

function requiredAutoReplyPermissions(type: ChannelType | undefined): bigint[] {
  const base = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  if (
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread
  ) {
    return [...base, PermissionFlagsBits.SendMessagesInThreads];
  }
  return [...base, PermissionFlagsBits.SendMessages];
}
