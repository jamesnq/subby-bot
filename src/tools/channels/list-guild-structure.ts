import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel, type NonThreadGuildBasedChannel } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { describeChannel } from "../context";

const schema = z.object({});

function isNonThread(c: GuildBasedChannel): c is NonThreadGuildBasedChannel {
  return !c.isThread();
}

function buildStructure(guild: Guild) {
  const categories = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      children: guild.channels.cache
        .filter((c): c is NonThreadGuildBasedChannel => c.type !== ChannelType.GuildCategory && !c.isThread() && "parentId" in c && c.parentId === cat.id)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map((c) => describeChannel(c)),
    }));

  const ungrouped = guild.channels.cache
    .filter(
      (c): c is NonThreadGuildBasedChannel =>
        c.type !== ChannelType.GuildCategory &&
        !c.isThread() &&
        (!("parentId" in c) || c.parentId === null),
    )
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => describeChannel(c));

  return {
    categories: categories.map((c) => ({ ...c, children: [...c.children] })),
    ungrouped: [...ungrouped],
    roleCount: guild.roles.cache.size,
    memberCount: guild.memberCount,
  };
}

export const listGuildStructureTool = defineTool({
  name: "list_guild_structure",
  description:
    "Liệt kê toàn bộ cấu trúc server Discord: categories, channel con, roles và số thành viên",
  risk: "read",
  group: "read",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ViewChannel],
  async preview(ctx) {
    return {
      title: "Cấu trúc server",
      lines: [`Server: ${ctx.guild.name}`],
    };
  },
  async execute(ctx) {
    return buildStructure(ctx.guild);
  },
});
