import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { z } from "zod";
import { defineTool } from "../registry";
import { parseChannelRef } from "../context";
import { authFail } from "@shared/errors";

export const PERMISSION_NAMES = Object.keys(PermissionFlagsBits).filter(
  (k) => !["All", "Administrator"].includes(k),
);

const DANGEROUS_GRANTS = new Set<string>([
  "ManageRoles",
  "ManageWebhooks",
  "ManageGuild",
  "MentionEveryone",
  "BanMembers",
  "KickMembers",
  "ModerateMembers",
  "ManageNicknames",
]);

const schema = z.object({
  channelRef: z.string().min(1).describe("Channel cần set quyền"),
  roleName: z.string().min(1).describe("Role bị áp dụng overwrite (id, @mention hoặc tên)"),
  allow: z
    .array(z.enum(PERMISSION_NAMES as [string, ...string[]]))
    .max(20)
    .default([])
    .describe("Danh sách quyền được CHO PHÉP"),
  deny: z
    .array(z.enum(PERMISSION_NAMES as [string, ...string[]]))
    .max(20)
    .default([])
    .describe("Danh sách quyền bị TỪ CHỐI"),
});

function resolveRole(guild: import("discord.js").Guild, ref: string) {
  const mention = /^<@&(\d{17,20})>$/.exec(ref.trim());
  const raw = /^(\d{17,20})$/.exec(ref.trim());
  const id = mention?.[1] ?? raw?.[1];
  if (id) {
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }
  return (
    guild.roles.cache.find(
      (r) => r.name.toLowerCase() === ref.replace(/^@/, "").trim().toLowerCase(),
    ) ?? null
  );
}

export const setChannelPermissionsTool = defineTool({
  name: "set_channel_permissions",
  description:
    "Set permission overwrite cho một role trong channel (allow/deny từng quyền riêng lẻ)",
  risk: "destructive",
  group: "channel",
  schema,
  requiredBotPermissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
  authorize(ctx) {
    if (!ctx.settings.destructiveEnabled) {
      return authFail("Server đã tắt các hành động destructive");
    }
    if (!ctx.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return authFail("Bạn cần quyền Manage Roles để chỉnh permission");
    }
    return { ok: true };
  },
  async preview(ctx, input) {
    const role = resolveRole(ctx.guild, input.roleName);
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    return {
      title: "⚠️ Set permission override",
      lines: [
        `Channel: ${resolved.ok ? `<#${resolved.value.id}>` : input.channelRef}`,
        `Role: ${role ? `@${role.name}` : input.roleName}`,
        `Allow: ${input.allow.length > 0 ? input.allow.join(", ") : "(không đổi)"}`,
        `Deny: ${input.deny.length > 0 ? input.deny.join(", ") : "(không đổi)"}`,
      ],
    };
  },
  async execute(ctx, input) {
    const resolved = parseChannelRef(ctx.guild, input.channelRef);
    if (!resolved.ok) throw new Error(resolved.reason);
    const ch = resolved.value;
    if (ch.type === ChannelType.GuildCategory) {
      throw new Error("Hãy dùng sync_category_permissions cho category");
    }

    const role = resolveRole(ctx.guild, input.roleName);
    if (!role) throw new Error(`Không tìm thấy role "${input.roleName}"`);

    const blocked = (input.allow ?? []).filter((p) => DANGEROUS_GRANTS.has(p));
    if (blocked.length > 0) {
      throw new Error(
        `Không được cấp các quyền nhạy cảm qua bot: ${blocked.join(", ")}. Hãy nhờ admin cấp thủ công.`,
      );
    }
    const safeAllow = (input.allow ?? []).filter((p) => !DANGEROUS_GRANTS.has(p));

    const allowBits = new PermissionsBitField();
    const denyBits = new PermissionsBitField();
    for (const p of safeAllow) allowBits.add(p as keyof typeof PermissionFlagsBits);
    for (const p of input.deny ?? []) denyBits.add(p as keyof typeof PermissionFlagsBits);

    await ch.permissionOverwrites.edit(
      role,
      { ...Object.fromEntries(allowBits.toArray().map((p) => [p, true])), ...Object.fromEntries(denyBits.toArray().map((p) => [p, false])) },
      { reason: `AI set_channel_permissions (${ctx.requestId})` },
    );

    return {
      channelId: ch.id,
      roleId: role.id,
      roleName: role.name,
      allowed: allowBits.toArray(),
      denied: denyBits.toArray(),
    };
  },
});
