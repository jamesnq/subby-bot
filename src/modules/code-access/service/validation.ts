import { config } from "@config";
import type { CodeAccessOcrResult } from "../ocr";
import { hasStrongDeviceIdentity } from "./fingerprint";

export function missingSignupFields(result: CodeAccessOcrResult): string[] {
  const missing: string[] = [];
  if (!result.order?.planKind) missing.push("plan_kind");
  if (!result.device.deviceName) missing.push("device_name");
  if (!result.device.osVersion) missing.push("os_version");
  if (!hasStrongDeviceIdentity(result.device)) missing.push("device_id hoặc product_id");
  return missing;
}

export function isFreshScreenshot(capturedAt: string | null, now = new Date()): boolean {
  if (!capturedAt) return false;
  const captured = new Date(capturedAt);
  if (!Number.isFinite(captured.getTime())) return false;
  return Math.abs(now.getTime() - captured.getTime()) <= config.CODE_ACCESS_SCREENSHOT_MAX_AGE_MINUTES * 60_000;
}

export function evidenceFlags(result: CodeAccessOcrResult, requireSteamPrompt: boolean, now = new Date()): string[] {
  const flags = new Set<string>(result.flags);
  if (!result.fullScreenVisible) flags.add("cropped");
  if (!isFreshScreenshot(result.capturedAt, now)) flags.add("stale_shot");
  if (!hasStrongDeviceIdentity(result.device)) flags.add("weak_fingerprint");
  if (!result.device.osVersion) flags.add("no_os_version");
  if (requireSteamPrompt && !result.steamLoginPromptVisible) flags.add("no_steam_prompt");
  return [...flags];
}
