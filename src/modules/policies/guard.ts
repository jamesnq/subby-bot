import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { config } from "@config";

export const ADMIN_DENY_MESSAGE =
  "⛔ Lệnh quản lý server chỉ dành cho **ADMIN**. Bạn không có quyền thực hiện hành động này.";

export function isAdminUser(userId: string): boolean {
  return userId === config.ADMIN_DISCORD_ID;
}

export function isAdminMember(member: GuildMember): boolean {
  if (member.id === config.ADMIN_DISCORD_ID) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.guild.ownerId === member.id) return true;
  return false;
}
