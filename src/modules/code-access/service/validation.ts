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

/**
 * `checkFreshness` gates the `stale_shot` flag. Signup evidence (order/device
 * screenshots) has no meaningful "how many minutes old" requirement — callers
 * pass false there. A `/code request` screenshot proves the user is at the
 * keyboard *right now*, so callers there pass true.
 */
export function evidenceFlags(result: CodeAccessOcrResult, requireSteamPrompt: boolean, checkFreshness: boolean, now = new Date()): string[] {
  const flags = new Set<string>(result.flags);
  if (!result.fullScreenVisible) flags.add("cropped");
  if (checkFreshness && !isFreshScreenshot(result.capturedAt, now)) flags.add("stale_shot");
  if (!hasStrongDeviceIdentity(result.device)) flags.add("weak_fingerprint");
  if (!result.device.osVersion) flags.add("no_os_version");
  if (requireSteamPrompt && !result.steamLoginPromptVisible) flags.add("no_steam_prompt");
  return [...flags];
}

/**
 * Single source of truth for turning an internal flag code (from
 * evidenceFlags or the OCR model's own `flags`) into a sentence a user can
 * actually act on. Every place that shows evidence flags to a user — not an
 * admin, who can be trusted to read the raw code — must go through this,
 * never `flags.join(", ")` directly.
 */
const FLAG_LABELS: Record<string, string> = {
  cropped: "ảnh bị cắt, cần chụp toàn màn hình",
  stale_shot: "không thấy giờ/ngày mới trong ảnh",
  weak_fingerprint: "không đọc được Device ID hoặc Product ID",
  no_os_version: "không đọc được phiên bản Windows",
  no_steam_prompt: "không thấy cửa sổ Steam đang hỏi mã",
  no_clock: "không thấy đồng hồ/ngày giờ trong ảnh",
  edited: "ảnh có dấu hiệu chỉnh sửa",
  unreadable: "ảnh quá mờ, không đọc được",
};

export function explainEvidenceFlags(flags: string[]): string {
  return flags.map((flag) => FLAG_LABELS[flag] ?? flag).join("; ");
}
