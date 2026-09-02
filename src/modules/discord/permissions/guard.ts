import { and, eq } from "drizzle-orm";
import type { GuildMember } from "discord.js";
import { db } from "../../database/db";
import {
  guildAiChannels,
  guildAllowedRoles,
  guildSettings,
  type GuildSettingsRow,
} from "../../database/schema";
import { hitRateLimit } from "../../policies/rate-limit";
import { config } from "@config";

export {
  isAdminUser,
  isAdminMember,
  ADMIN_DENY_MESSAGE,
} from "./admin";

export async function getGuildSettings(guildId: string): Promise<GuildSettingsRow> {
  const existing = await db.select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const inserted = await db.insert(guildSettings)
    .values({ guildId })
    .onConflictDoUpdate({ target: guildSettings.guildId, set: { updatedAt: new Date() } })
    .returning();
  if (inserted.length > 0) return inserted[0];

  const retry = await db.select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1);
  if (retry.length === 0) throw new Error(`Không tạo được settings cho guild ${guildId}`);
  return retry[0];
}

export async function isAiChannelAllowed(
  settings: GuildSettingsRow,
  guildId: string,
  channelId: string,
): Promise<boolean> {
  if (settings.allChannels) return true;
  const rows = await db.select({ channelId: guildAiChannels.channelId })
    .from(guildAiChannels)
    .where(and(eq(guildAiChannels.guildId, guildId), eq(guildAiChannels.channelId, channelId)))
    .limit(1);
  return rows.length > 0;
}

export async function hasAllowedRole(
  guildId: string,
  memberRoleIds: string[],
): Promise<boolean> {
  const rows = await db.select({ roleId: guildAllowedRoles.roleId })
    .from(guildAllowedRoles)
    .where(eq(guildAllowedRoles.guildId, guildId));

  if (rows.length === 0) return true;
  const allowed = new Set(rows.map((r) => r.roleId));
  return memberRoleIds.some((r) => allowed.has(r));
}

export function isUserWithinRateLimit(userId: string): boolean {
  return hitRateLimit(`user:${userId}`, config.RATE_LIMIT_USER_PER_MINUTE);
}

export async function listAllowedChannels(guildId: string): Promise<string[]> {
  const rows = await db.select({ channelId: guildAiChannels.channelId })
    .from(guildAiChannels)
    .where(eq(guildAiChannels.guildId, guildId));
  return rows.map((r) => r.channelId);
}

export async function listAllowedRoleIds(guildId: string): Promise<string[]> {
  const rows = await db.select({ roleId: guildAllowedRoles.roleId })
    .from(guildAllowedRoles)
    .where(eq(guildAllowedRoles.guildId, guildId));
  return rows.map((r) => r.roleId);
}

export async function addAiChannel(
  guildId: string,
  channelId: string,
  addedBy: string,
): Promise<void> {
  await db.insert(guildAiChannels).values({ guildId, channelId, addedBy }).onConflictDoNothing();
}

export async function removeAiChannel(guildId: string, channelId: string): Promise<boolean> {
  const deleted = await db.delete(guildAiChannels)
    .where(and(eq(guildAiChannels.guildId, guildId), eq(guildAiChannels.channelId, channelId)))
    .returning();
  return deleted.length > 0;
}

export async function addAllowedRole(guildId: string, roleId: string, addedBy: string): Promise<void> {
  await db.insert(guildAllowedRoles).values({ guildId, roleId, addedBy }).onConflictDoNothing();
}

export async function removeAllowedRole(guildId: string, roleId: string): Promise<boolean> {
  const deleted = await db.delete(guildAllowedRoles)
    .where(and(eq(guildAllowedRoles.guildId, guildId), eq(guildAllowedRoles.roleId, roleId)))
    .returning();
  return deleted.length > 0;
}

export async function updateGuildSetting<K extends keyof GuildSettingsRow>(
  guildId: string,
  key: K,
  value: GuildSettingsRow[K],
): Promise<void> {
  await getGuildSettings(guildId);
  await db.update(guildSettings)
    .set({ [key]: value, updatedAt: new Date() })
    .where(eq(guildSettings.guildId, guildId));
}

export function memberRoleIds(member: GuildMember): string[] {
  return [...member.roles.cache.keys()];
}


