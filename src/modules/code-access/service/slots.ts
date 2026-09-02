import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import {
  codeAccessDevices,
  codeAccessSlots,
  type CodeAccessDeviceRow,
  type CodeAccessSlotRow,
} from "../../database/schema";
import type { WindowsDeviceInfo } from "../ocr";
import { normalizeSteamUsername } from "../accounts";
import { fingerprintDevice, matchDeviceFingerprint } from "./fingerprint";

export type BoundCodeAccessSlot = { slot: CodeAccessSlotRow; device: CodeAccessDeviceRow };

export async function listUserSlots(guildId: string, userId: string): Promise<BoundCodeAccessSlot[]> {
  return db.select({ slot: codeAccessSlots, device: codeAccessDevices })
    .from(codeAccessSlots)
    .innerJoin(codeAccessDevices, eq(codeAccessSlots.deviceId, codeAccessDevices.id))
    .where(and(eq(codeAccessSlots.guildId, guildId), eq(codeAccessSlots.userId, userId)))
    .orderBy(desc(codeAccessSlots.createdAt));
}

export async function getCodeAccessSlot(input: { guildId: string; userId: string; steamUsername: string }): Promise<CodeAccessSlotRow | undefined> {
  const username = normalizeSteamUsername(input.steamUsername);
  if (!username) return undefined;
  const rows = await db.select().from(codeAccessSlots).where(and(
    eq(codeAccessSlots.guildId, input.guildId),
    eq(codeAccessSlots.userId, input.userId),
    eq(codeAccessSlots.steamUsername, username),
  )).orderBy(desc(codeAccessSlots.updatedAt)).limit(1);
  return rows[0];
}

export async function getBoundSlotById(slotId: string): Promise<BoundCodeAccessSlot | undefined> {
  const rows = await db.select({ slot: codeAccessSlots, device: codeAccessDevices })
    .from(codeAccessSlots).innerJoin(codeAccessDevices, eq(codeAccessSlots.deviceId, codeAccessDevices.id))
    .where(eq(codeAccessSlots.id, slotId)).limit(1);
  return rows[0];
}

export async function findBoundSlotForDevice(input: {
  guildId: string;
  userId: string;
  device: WindowsDeviceInfo;
}): Promise<BoundCodeAccessSlot | undefined> {
  const fingerprint = fingerprintDevice(input.device);
  if (fingerprint.hash) {
    const exact = await db.select({ slot: codeAccessSlots, device: codeAccessDevices })
      .from(codeAccessDevices).innerJoin(codeAccessSlots, eq(codeAccessSlots.deviceId, codeAccessDevices.id))
      .where(and(
        eq(codeAccessDevices.fingerprintHash, fingerprint.hash),
        eq(codeAccessDevices.guildId, input.guildId),
        eq(codeAccessDevices.userId, input.userId),
      )).limit(1);
    if (exact[0]) return exact[0];
  }
  const candidates = await listUserSlots(input.guildId, input.userId);
  return candidates.find(({ device }) => matchDeviceFingerprint(device.deviceJson as WindowsDeviceInfo, input.device).matches);
}

export async function markSlotIssued(slotId: string, deviceId: string, now = new Date()): Promise<void> {
  await Promise.all([
    db.update(codeAccessSlots).set({ lastCodeIssuedAt: now, updatedAt: now }).where(eq(codeAccessSlots.id, slotId)),
    db.update(codeAccessDevices).set({ lastVerifiedAt: now, updatedAt: now }).where(eq(codeAccessDevices.id, deviceId)),
  ]);
}

export async function prepareSlotRebind(slotId: string): Promise<CodeAccessSlotRow | undefined> {
  const bound = await getBoundSlotById(slotId);
  if (!bound) return undefined;
  const placeholderHash = crypto.createHash("sha256").update(`rebind:${slotId}:${Date.now()}`).digest("hex");
  return db.transaction(async (tx) => {
    const placeholder = await tx.insert(codeAccessDevices).values({
      guildId: bound.slot.guildId, userId: bound.slot.userId, fingerprintHash: placeholderHash,
      deviceJson: { rebindRequired: true }, deviceType: bound.device.deviceType,
    }).returning();
    const updated = await tx.update(codeAccessSlots).set({
      deviceId: placeholder[0].id, status: "suspended", suspendReason: "rebind_required", updatedAt: new Date(),
    }).where(eq(codeAccessSlots.id, slotId)).returning();
    await tx.delete(codeAccessDevices).where(eq(codeAccessDevices.id, bound.device.id));
    return updated[0];
  });
}
