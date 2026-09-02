import { config } from "@config";
import { writeAudit } from "../../database/audit";
import type { CodeAccessOcrResult } from "../ocr";
import { findLatestSteamCodeWithCache } from "../steam-code-cache";
import { consumeApprovedRequestEscalation } from "../escalations";
import { findBoundSlotForDevice, markSlotIssued } from "./slots";
import { isSubscriptionActive } from "./subscriptions";
import { evidenceFlags } from "./validation";

export type IssuedCode = { code: string; account: string; receivedAt?: string };

export async function issueSteamCode(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  ocr: CodeAccessOcrResult;
  now?: Date;
  adminApprovedEscalationId?: string;
}): Promise<IssuedCode> {
  if (!config.CODE_ACCESS_ISSUE_CODES) throw new Error("Chức năng phát mã đang được tắt khẩn cấp.");
  if (!config.GMAIL_ENABLED) throw new Error("Nguồn mã Steam hiện chưa sẵn sàng.");
  const now = input.now ?? new Date();
  const binding = await findBoundSlotForDevice({ guildId: input.guildId, userId: input.userId, device: input.ocr.device });
  if (!binding || binding.slot.steamUsername !== input.steamUsername || binding.slot.status !== "approved" || !isSubscriptionActive(binding.slot.subscriptionEnd, now)) {
    throw new Error("Quyền phát mã không còn hợp lệ; hãy chạy lại `/code request`.");
  }
  const flags = evidenceFlags(input.ocr, true, true, now);
  const allowedByAdmin = Boolean(input.adminApprovedEscalationId);
  const blocking = flags.filter((flag) => (allowedByAdmin ? ["stale_shot", "no_steam_prompt"] : ["cropped", "stale_shot", "weak_fingerprint", "no_os_version", "no_steam_prompt", "edited", "unreadable"]).includes(flag));
  if (blocking.length || (input.ocr.confidence < config.CODE_ACCESS_ESCALATE_BELOW && !allowedByAdmin)) {
    throw new Error("Ảnh không còn đáp ứng đủ điều kiện phát mã.");
  }
  const lockedOs = binding.device.osVersionLocked?.replace(/\s+/g, "").toUpperCase();
  const currentOs = input.ocr.device.osVersion?.replace(/\s+/g, "").toUpperCase();
  if (config.CODE_ACCESS_OS_POLICY === "suspend" && lockedOs && currentOs && lockedOs !== currentOs) {
    throw new Error("Phiên bản Windows không còn khớp máy đã đăng ký.");
  }
  const result = await findLatestSteamCodeWithCache(input.steamUsername);
  if (!result) throw new Error("Không tìm thấy mã Steam mới nhất.");
  await markSlotIssued(binding.slot.id, binding.device.id, now);
  if (input.adminApprovedEscalationId) await consumeApprovedRequestEscalation(input.adminApprovedEscalationId);
  await writeAudit({
    guildId: input.guildId,
    actorId: input.userId,
    action: "code_access.code_issued",
    targetType: "code_access_slot",
    targetId: binding.slot.id,
    details: { account: input.steamUsername, issuedAt: now.toISOString() },
  });
  return { code: result.entry.code, account: input.steamUsername, receivedAt: result.entry.receivedAt };
}
