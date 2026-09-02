import { ChannelType, type CategoryChannel, type Guild, type NonThreadGuildBasedChannel } from "discord.js";
import type { ResolveResult } from "@shared/errors";

const SNOWFLAKE_MENTION = /^<#(\d{17,20})>$/;
const RAW_SNOWFLAKE = /^(\d{17,20})$/;

function ok<T>(value: T): ResolveResult<T> {
  return { ok: true, value };
}

function fail(reason: string): ResolveResult<never> {
  return { ok: false, reason };
}

export function parseChannelRef(
  guild: Guild,
  ref: string,
): ResolveResult<NonThreadGuildBasedChannel> {
  const mention = SNOWFLAKE_MENTION.exec(ref);
  const raw = RAW_SNOWFLAKE.exec(ref);
  const id = mention?.[1] ?? raw?.[1];

  if (id) {
    const channel = guild.channels.cache.get(id);
    if (!channel || channel.isThread()) return fail(`Không tìm thấy channel với id ${ref}`);
    if (channel.type === ChannelType.GuildCategory) {
      return fail(`${ref} là category, không phải channel`);
    }
    return ok(channel as NonThreadGuildBasedChannel);
  }

  const name = ref.replace(/^#/, "").trim().toLowerCase();
  if (!name) return fail("Tên channel rỗng");

  const matches = guild.channels.cache.filter(
    (c): c is NonThreadGuildBasedChannel =>
      !c.isThread() &&
      c.type !== ChannelType.GuildCategory &&
      c.name.toLowerCase() === name,
  );

  if (matches.size === 0) {
    const suggestions = guild.channels.cache
      .filter((c) => !c.isThread() && c.type !== ChannelType.GuildCategory)
      .map((c) => c.name)
      .slice(0, 8)
      .join(", ");
    return fail(`Không tìm thấy channel "${ref}". Các channel hiện có: ${suggestions}`);
  }

  if (matches.size > 1) {
    const ids = matches.map((c) => `<#${c.id}>`).slice(0, 3).join(", ");
    return fail(`Nhiều channel trùng tên "${ref}", hãy chỉ định id rõ ràng: ${ids}`);
  }

  return ok(matches.first()!);
}

export function parseCategoryRef(guild: Guild, ref: string): ResolveResult<CategoryChannel> {
  const mention = SNOWFLAKE_MENTION.exec(ref);
  const raw = RAW_SNOWFLAKE.exec(ref);
  const id = mention?.[1] ?? raw?.[1];

  if (id) {
    const channel = guild.channels.cache.get(id);
    if (!channel || channel.type !== ChannelType.GuildCategory) {
      return fail(`Không tìm thấy category với id ${ref}`);
    }
    return ok(channel as CategoryChannel);
  }

  const name = ref.replace(/^#/, "").trim().toLowerCase();
  const matches = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name,
  );

  if (matches.size === 0) {
    return fail(`Không tìm thấy category "${ref}"`);
  }
  if (matches.size > 1) {
    return fail(`Nhiều category trùng tên "${ref}", hãy chỉ định id rõ ràng`);
  }
  return ok(matches.first() as CategoryChannel);
}

export function describeChannel(channel: NonThreadGuildBasedChannel): string {
  switch (channel.type) {
    case ChannelType.GuildText:
      return `text #${channel.name}`;
    case ChannelType.GuildVoice:
      return `voice 🔊 ${channel.name}`;
    case ChannelType.GuildAnnouncement:
      return `announcement 📢 ${channel.name}`;
    case ChannelType.GuildForum:
      return `forum 🧵 ${channel.name}`;
    case ChannelType.GuildStageVoice:
      return `stage 🎙 ${channel.name}`;
    default:
      return `${channel.name} (${channel.type})`;
  }
}

export function listCategoryChildren(
  guild: Guild,
  categoryId: string,
): NonThreadGuildBasedChannel[] {
  return guild.channels.cache
    .filter(
      (c): c is NonThreadGuildBasedChannel =>
        !c.isThread() &&
        c.type !== ChannelType.GuildCategory &&
        "parentId" in c &&
        c.parentId === categoryId,
    )
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => c);
}
