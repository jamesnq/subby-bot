import { and, eq, ne, or, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { codeAccessDevices, codeAccessSlots } from "../../database/schema";
import type { FraudFlag } from "./decisions";
import type { WindowsDeviceInfo } from "../ocr";
import { matchDeviceFingerprint } from "./fingerprint";

export async function detectSignupFraud(input: {
  guildId: string;
  userId: string;
  purchaseProofSha256: string;
  orderCode: string | null;
  fingerprintHash: string;
  device: WindowsDeviceInfo;
}): Promise<FraudFlag[]> {
  const [duplicateBill, reusedOrder, exactDevice] = await Promise.all([
    db.select({ id: codeAccessSlots.id }).from(codeAccessSlots).where(and(
      eq(codeAccessSlots.purchaseProofSha256, input.purchaseProofSha256),
      ne(codeAccessSlots.userId, input.userId),
    )).limit(1),
    input.orderCode
      ? db.select({ id: codeAccessSlots.id }).from(codeAccessSlots).where(and(
        eq(codeAccessSlots.guildId, input.guildId),
        eq(codeAccessSlots.orderCode, input.orderCode),
        ne(codeAccessSlots.userId, input.userId),
      )).limit(1)
      : Promise.resolve([]),
    db.select({ id: codeAccessDevices.id }).from(codeAccessDevices)
      .where(eq(codeAccessDevices.fingerprintHash, input.fingerprintHash)).limit(1),
  ]);
  let sharedDevice = exactDevice.length > 0;
  if (!sharedDevice) {
    const candidates = await db.select({ deviceJson: codeAccessDevices.deviceJson }).from(codeAccessDevices).where(or(
      normalizedJsonEquals("productId", input.device.productId),
      normalizedJsonEquals("deviceName", input.device.deviceName),
      normalizedJsonEquals("motherboard", input.device.motherboard),
      normalizedJsonEquals("processor", input.device.processor),
    )).limit(100);
    sharedDevice = candidates.some((candidate) => matchDeviceFingerprint(candidate.deviceJson as WindowsDeviceInfo, input.device).matches);
  }
  return fraudFlagsFromMatches({ duplicateBill: duplicateBill.length > 0, reusedOrder: reusedOrder.length > 0, sharedDevice });
}

function normalizedJsonEquals(field: string, value: string | null): ReturnType<typeof sql> {
  if (!value) return sql`false`;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (field === "productId") return sql`lower(regexp_replace(coalesce(${codeAccessDevices.deviceJson}->>'productId', ''), '[^a-zA-Z0-9]', '', 'g')) = ${normalized}`;
  if (field === "deviceName") return sql`lower(regexp_replace(coalesce(${codeAccessDevices.deviceJson}->>'deviceName', ''), '[^a-zA-Z0-9]', '', 'g')) = ${normalized}`;
  if (field === "motherboard") return sql`lower(regexp_replace(coalesce(${codeAccessDevices.deviceJson}->>'motherboard', ''), '[^a-zA-Z0-9]', '', 'g')) = ${normalized}`;
  return sql`lower(regexp_replace(coalesce(${codeAccessDevices.deviceJson}->>'processor', ''), '[^a-zA-Z0-9]', '', 'g')) = ${normalized}`;
}

export function fraudFlagsFromMatches(input: { duplicateBill: boolean; reusedOrder: boolean; sharedDevice: boolean }): FraudFlag[] {
  const flags: FraudFlag[] = [];
  if (input.duplicateBill) flags.push("duplicate_bill");
  if (input.reusedOrder) flags.push("order_reused");
  if (input.sharedDevice) flags.push("device_shared");
  return flags;
}
