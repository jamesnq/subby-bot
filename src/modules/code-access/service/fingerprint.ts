import crypto from "node:crypto";
import type { WindowsDeviceInfo } from "../ocr";

export type DeviceFingerprint = { hash: string; label: string; source: "device_id" | "tier_2" | "insufficient" };
export type DeviceMatch = { matches: boolean; method: "device_id" | "tier_2" | "none"; tier2Matches: number };

const TIER_2_FIELDS = ["productId", "deviceName", "motherboard", "processor"] as const;

export function fingerprintDevice(input: WindowsDeviceInfo | { deviceFingerprint: unknown }): DeviceFingerprint {
  const device = coerceDevice(input);
  const deviceId = canonical(device.deviceId);
  if (deviceId) return hashed(`device-id:${deviceId}`, device.deviceName ?? device.deviceId!, "device_id");
  const parts = TIER_2_FIELDS.map((field) => [field, canonical(device[field])] as const)
    .filter((entry): entry is readonly [typeof TIER_2_FIELDS[number], string] => Boolean(entry[1]));
  if (parts.length === 0) return { hash: "", label: "unknown-device", source: "insufficient" };
  const value = parts.map(([field, part]) => `${field}:${part}`).join("|");
  const label = [device.deviceName, device.motherboard, device.processor].filter(Boolean).join(" · ") || "Windows device";
  return hashed(`tier-2:${value}`, label, "tier_2");
}

export function matchDeviceFingerprint(stored: WindowsDeviceInfo, current: WindowsDeviceInfo): DeviceMatch {
  const storedId = canonical(stored.deviceId);
  const currentId = canonical(current.deviceId);
  if (storedId && currentId) {
    const matches = storedId === currentId;
    return { matches, method: matches ? "device_id" : "none", tier2Matches: 0 };
  }
  let comparable = 0;
  let matches = 0;
  for (const field of TIER_2_FIELDS) {
    const left = canonical(stored[field]);
    const right = canonical(current[field]);
    if (!left || !right) continue;
    comparable += 1;
    if (left === right) matches += 1;
  }
  const passed = comparable >= 3 && matches >= 3;
  return { matches: passed, method: passed ? "tier_2" : "none", tier2Matches: matches };
}

export function sameDeviceFingerprint(
  stored: { fingerprintHash?: string | null; deviceFingerprintHash?: string | null; deviceJson?: unknown },
  current: WindowsDeviceInfo | { deviceFingerprint: unknown },
): boolean {
  const currentDevice = coerceDevice(current);
  if (stored.deviceJson && typeof stored.deviceJson === "object") {
    return matchDeviceFingerprint(stored.deviceJson as WindowsDeviceInfo, currentDevice).matches;
  }
  const storedHash = stored.fingerprintHash ?? stored.deviceFingerprintHash;
  return !storedHash || storedHash === fingerprintDevice(currentDevice).hash;
}

export function hasStrongDeviceIdentity(device: WindowsDeviceInfo): boolean {
  return Boolean(canonical(device.deviceId) || canonical(device.productId));
}

function hashed(value: string, label: string, source: DeviceFingerprint["source"]): DeviceFingerprint {
  return {
    hash: crypto.createHash("sha256").update(value).digest("hex"),
    label: label.replace(/\s+/g, " ").trim().slice(0, 240),
    source,
  };
}

function canonical(value: string | null | undefined): string | null {
  const result = value?.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
  return result || null;
}

function coerceDevice(input: WindowsDeviceInfo | { deviceFingerprint: unknown }): WindowsDeviceInfo {
  if (!("deviceFingerprint" in input)) return input;
  const legacy = input.deviceFingerprint as Record<string, unknown>;
  return {
    deviceName: text(legacy.deviceName), motherboard: text(legacy.motherboard ?? legacy.model),
    processor: text(legacy.processor), installedRam: text(legacy.installedRam), graphicsCard: text(legacy.graphicsCard),
    storage: text(legacy.storage), deviceId: text(legacy.deviceId ?? legacy.serialNumber ?? legacy.hardwareId),
    productId: text(legacy.productId ?? legacy.androidId ?? legacy.imei ?? legacy.udid), systemType: text(legacy.systemType),
    osEdition: text(legacy.osEdition ?? legacy.platform), osVersion: text(legacy.osVersion), osBuild: text(legacy.osBuild),
    installedOn: text(legacy.installedOn),
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
