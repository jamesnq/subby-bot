import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type NonThreadGuildBasedChannel,
} from "discord.js";
import { getDiscordClient } from "../discord/client";
import { getGuildSettings } from "../discord/permissions/guard";
import { ExecutionContext } from "./executor";
import type { AgentState } from "./state";

function asSendable(
  channel: NonThreadGuildBasedChannel | import("discord.js").PublicThreadChannel<boolean> | import("discord.js").PrivateThreadChannel,
): channel is import("discord.js").TextChannel {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

export async function buildExecutionContext(state: AgentState): Promise<ExecutionContext> {
  const client = getDiscordClient();
  const guild = await client.guilds.fetch(state.guildId);
  const member = await guild.members.fetch(state.userId);
  const fetched = await client.channels.fetch(state.channelId);
  if (!fetched || fetched.isDMBased() || !asSendable(fetched)) {
    throw new Error("Bot chỉ xử lý lệnh trong text channel hoặc announcement channel");
  }
  const settings = await getGuildSettings(state.guildId);
  return {
    requestId: state.requestId,
    guild,
    member,
    channel: fetched,
    settings,
    allowMentions: member.permissions.has(PermissionFlagsBits.MentionEveryone),
  };
}

export async function describeServerContext(guild: Guild, channelId?: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`Server: ${guild.name} (id: ${guild.id})`);
  if (channelId) {
    const current = guild.channels.cache.get(channelId);
    if (current) lines.push(`Channel hiện tại: #${current.name} (<#${current.id}>)`);
  }
  lines.push(`Số thành viên: ${guild.memberCount}`);

  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const cat of categories.values()) {
    const children = guild.channels.cache
      .filter(
        (c) =>
          c.type !== ChannelType.GuildCategory &&
          "parentId" in c &&
          c.parentId === cat.id,
      )
      .map((c) => `#${c.name}(<#${c.id}>)`)
      .join(", ");
    lines.push(`Category "${cat.name}" (id ${cat.id}): ${children || "(trống)"}`);
  }

  const orphans = guild.channels.cache
    .filter(
      (c) =>
        c.type !== ChannelType.GuildCategory &&
        (!("parentId" in c) || c.parentId === null),
    )
    .map((c) => `#${c.name}(<#${c.id}>)`)
    .join(", ");
  if (orphans) lines.push(`Không có category: ${orphans}`);

  return lines.join("\n");
}
