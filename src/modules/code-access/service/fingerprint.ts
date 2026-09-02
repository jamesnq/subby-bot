import crypto from "node:crypto";
import type { CodeAccessEntitlementRow } from "../../database/schema";
import type { CodeAccessVerificationResult } from "../verification";

export function fingerprintDevice(result: Pick<CodeAccessVerificationResult, "deviceFingerprint">): {
  hash: string;
  label: string;
} {
  const fingerprint = result.deviceFingerprint;
  const parts = [
    fingerprint.deviceName,
    fingerprint.platform,
    fingerprint.model,
    fingerprint.osVersion,
    fingerprint.serialNumber,
    fingerprint.imei,
    fingerprint.meid,
    fingerprint.androidId,
    fingerprint.udid,
    fingerprint.hardwareId,
    ...fingerprint.rawVisibleIdentifiers,
  ]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const canonical = parts.join("|") || "unknown-device";
  if (canonical === "unknown-device") {
    return { hash: "", label: "unknown-device" };
  }
  return {
    hash: crypto.createHash("sha256").update(canonical).digest("hex"),
    label: parts.slice(0, 4).join(" / ").slice(0, 240) || "unknown-device",
  };
}

export function sameDeviceFingerprint(
  entitlement: Pick<CodeAccessEntitlementRow, "deviceFingerprintHash">,
  verification: CodeAccessVerificationResult,
): boolean {
  if (!entitlement.deviceFingerprintHash) return true;
  return entitlement.deviceFingerprintHash === fingerprintDevice(verification).hash;
}

export function hasDeviceFingerprint(result: CodeAccessVerificationResult): boolean {
  const fingerprint = result.deviceFingerprint;
  return Boolean(
    fingerprint.serialNumber ||
      fingerprint.imei ||
      fingerprint.meid ||
      fingerprint.androidId ||
      fingerprint.udid ||
      fingerprint.hardwareId ||
      fingerprint.rawVisibleIdentifiers.length > 0,
  );
}
