import { eq } from "drizzle-orm";
import { config } from "@config";
import { db } from "../../database/db";
import { writeAudit } from "../../database/audit";
import { codeAccessSlots, type CodeAccessDeviceRow, type CodeAccessSlotRow } from "../../database/schema";

export type OsPolicyResult =
  | { ok: true; mismatch: false }
  | { ok: true; mismatch: true; warned: true }
  | { ok: false; mismatch: true; suspended: true };

export async function enforceOsPolicy(input: {
  slot: CodeAccessSlotRow;
  device: CodeAccessDeviceRow;
  currentOsVersion: string | null;
  confidence: number;
}): Promise<OsPolicyResult> {
  if (!hasOsVersionMismatch(input.device.osVersionLocked, input.currentOsVersion)) return { ok: true, mismatch: false };

  await writeAudit({
    guildId: input.slot.guildId,
    actorId: input.slot.userId,
    action: "code_access.os_mismatch",
    targetType: "code_access_slot",
    targetId: input.slot.id,
    details: { ocr_os: input.currentOsVersion, locked_os: input.device.osVersionLocked, confidence: input.confidence },
  });
  if (config.CODE_ACCESS_OS_POLICY === "warn") return { ok: true, mismatch: true, warned: true };

  await db.update(codeAccessSlots).set({
    status: "suspended",
    suspendReason: "os_upgraded",
    updatedAt: new Date(),
  }).where(eq(codeAccessSlots.id, input.slot.id));
  return { ok: false, mismatch: true, suspended: true };
}

export function hasOsVersionMismatch(lockedVersion: string | null, currentVersion: string | null): boolean {
  const locked = normalizeVersion(lockedVersion);
  const current = normalizeVersion(currentVersion);
  return Boolean(locked && current && locked !== current);
}

function normalizeVersion(value: string | null): string | null {
  const result = value?.normalize("NFKC").toUpperCase().replace(/\s+/g, "").trim();
  return result || null;
}
