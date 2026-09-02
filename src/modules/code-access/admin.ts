import { and, eq, sql } from "drizzle-orm";
import { db } from "../database/db";
import { writeAudit } from "../database/audit";
import { codeAccessDevices, codeAccessSlots, type CodeAccessSlotRow } from "../database/schema";
import { isAllowedCodeAccessAccount, normalizeSteamUsername } from "./accounts";
import { fingerprintDevice } from "./service/fingerprint";
import { calculateSubscription } from "./service/subscriptions";
import { getBoundSlotById, prepareSlotRebind } from "./service/slots";
import type { PlanKind, WindowsDeviceInfo } from "./ocr";

export async function adminGrantSlot(input: {
  guildId: string; userId: string; discordUsername: string; steamUsername: string;
  planKind: PlanKind; deviceId: string; adminId: string; now?: Date;
}): Promise<CodeAccessSlotRow> {
  const username = normalizeSteamUsername(input.steamUsername);
  if (!username || !isAllowedCodeAccessAccount(username)) throw new Error("Account does not exist.");
  const now = input.now ?? new Date();
  const device = emptyDevice(input.deviceId);
  const fingerprint = fingerprintDevice(device);
  const subscription = calculateSubscription({ planKind: input.planKind, planUnits: 1, orderPlacedAt: now.toISOString(), now });
  const slot = await db.transaction(async (tx) => {
    const devices = await tx.insert(codeAccessDevices).values({
      guildId: input.guildId, userId: input.userId, fingerprintHash: fingerprint.hash,
      deviceJson: device, deviceType: "pc", lastVerifiedAt: now,
    }).returning();
    const rows = await tx.insert(codeAccessSlots).values({
      guildId: input.guildId, userId: input.userId, discordUsername: input.discordUsername.slice(0, 64),
      steamUsername: username, deviceId: devices[0].id, status: "approved", planKind: input.planKind,
      planUnits: input.planKind === "lifetime" ? null : 1, subscriptionStart: subscription.start,
      subscriptionEnd: subscription.end, onboardedAt: now,
    }).returning();
    return rows[0];
  });
  await writeAudit({ guildId: input.guildId, actorId: input.adminId, action: "code_access.admin_grant", targetType: "code_access_slot", targetId: slot.id, details: { userId: input.userId, username } });
  return slot;
}

export async function adminRebindSlot(input: { guildId: string; userId: string; slotId: string; adminId: string }): Promise<CodeAccessSlotRow | undefined> {
  const bound = await getBoundSlotById(input.slotId);
  if (!bound || bound.slot.guildId !== input.guildId || bound.slot.userId !== input.userId) return undefined;
  const row = await prepareSlotRebind(input.slotId);
  await writeAudit({ guildId: input.guildId, actorId: input.adminId, action: "code_access.admin_rebind", targetType: "code_access_slot", targetId: input.slotId, details: { userId: input.userId } });
  return row;
}

export async function adminRevokeSlot(input: { guildId: string; userId: string; slotId: string; adminId: string }): Promise<CodeAccessSlotRow | undefined> {
  const rows = await db.update(codeAccessSlots).set({ status: "revoked", suspendReason: null, updatedAt: new Date() }).where(and(
    eq(codeAccessSlots.id, input.slotId), eq(codeAccessSlots.guildId, input.guildId), eq(codeAccessSlots.userId, input.userId),
  )).returning();
  if (rows[0]) await writeAudit({ guildId: input.guildId, actorId: input.adminId, action: "code_access.admin_revoke", targetType: "code_access_slot", targetId: input.slotId, details: { userId: input.userId } });
  return rows[0];
}

export async function getCodeAccessStats(guildId: string): Promise<{
  totalSlots: number; osMismatches: number; issuedCodes: number; openEscalations: number;
  lowConfidenceEscalations: number; averageConfidence: number | null;
}> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM code_access_slots WHERE guild_id = ${guildId}) AS total_slots,
      (SELECT count(*)::int FROM audit_logs WHERE guild_id = ${guildId} AND action = 'code_access.os_mismatch') AS os_mismatches,
      (SELECT count(*)::int FROM audit_logs WHERE guild_id = ${guildId} AND action = 'code_access.code_issued') AS issued_codes,
      (SELECT count(*)::int FROM code_access_escalations WHERE guild_id = ${guildId} AND status = 'open') AS open_escalations,
      (SELECT count(*)::int FROM code_access_escalations WHERE guild_id = ${guildId} AND kind IN ('signup_low_conf', 'request_low_conf')) AS low_confidence_escalations,
      (SELECT avg(ocr_confidence)::real FROM code_access_slots WHERE guild_id = ${guildId}) AS average_confidence
  `);
  const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    totalSlots: Number(row.total_slots ?? 0), osMismatches: Number(row.os_mismatches ?? 0), issuedCodes: Number(row.issued_codes ?? 0),
    openEscalations: Number(row.open_escalations ?? 0), lowConfidenceEscalations: Number(row.low_confidence_escalations ?? 0),
    averageConfidence: row.average_confidence == null ? null : Number(row.average_confidence),
  };
}

function emptyDevice(deviceId: string): WindowsDeviceInfo {
  return { deviceName: "Admin grant", motherboard: null, processor: null, installedRam: null, graphicsCard: null, storage: null,
    deviceId, productId: null, systemType: null, osEdition: null, osVersion: null, osBuild: null, installedOn: null };
}
