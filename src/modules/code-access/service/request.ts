import { config } from "@config";
import type { CodeAccessOcrResult } from "../ocr";
import { isAllowedCodeAccessAccount, normalizeSteamUsername } from "../accounts";
import { closeOpenEscalationsForDraft, createEscalation, getOpenEscalation, getRecentApprovedRequestEscalation } from "../escalations";
import { evidenceFlags, explainEvidenceFlags } from "./validation";
import { findBoundSlotForDevice, listUserSlots, type BoundCodeAccessSlot } from "./slots";
import { isSubscriptionActive } from "./subscriptions";
import { enforceOsPolicy } from "./os-policy";

export type RequestEligibility =
  | { ok: true; binding: BoundCodeAccessSlot; osWarning: boolean; adminApprovedEscalationId?: string }
  | { ok: false; kind: "denied" | "escalated"; reason: string; escalationId?: string; accounts?: string[] };

export async function evaluateCodeRequest(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  draftId: string;
  ocr: CodeAccessOcrResult;
  evidenceKeys: string[];
  now?: Date;
  channelId?: string;
}): Promise<RequestEligibility> {
  const now = input.now ?? new Date();
  const username = normalizeSteamUsername(input.steamUsername);
  if (!username || !isAllowedCodeAccessAccount(username)) {
    return { ok: false, kind: "denied", reason: "Account does not exist." };
  }
  const slots = await listUserSlots(input.guildId, input.userId);
  if (slots.length === 0) return { ok: false, kind: "denied", reason: "Bạn cần đăng ký trước bằng `/code signup`." };
  const open = await getOpenEscalation({ guildId: input.guildId, userId: input.userId });
  if (open && open.draftId !== input.draftId) return { ok: false, kind: "escalated", reason: "Hồ sơ đang chờ admin xác nhận.", escalationId: open.id };

  const binding = await findBoundSlotForDevice({ guildId: input.guildId, userId: input.userId, device: input.ocr.device });
  if (!binding) return { ok: false, kind: "denied", reason: "Máy này chưa đăng ký.", accounts: slots.map((item) => item.slot.steamUsername) };
  if (binding.slot.steamUsername !== username) {
    return { ok: false, kind: "denied", reason: `Máy này đang gắn với account \`${binding.slot.steamUsername}\`.`, accounts: slots.map((item) => item.slot.steamUsername) };
  }
  if (binding.slot.status !== "approved") {
    const reason = binding.slot.suspendReason === "os_upgraded"
      ? "Máy đã nâng cấp phiên bản Windows nên gói đang bị tạm khoá."
      : `Gói đang ở trạng thái \`${binding.slot.status}\`.`;
    return { ok: false, kind: "denied", reason };
  }
  if (!isSubscriptionActive(binding.slot.subscriptionEnd, now)) {
    return { ok: false, kind: "denied", reason: "Gói sử dụng đã hết hạn. Vui lòng gia hạn." };
  }

  const adminApproved = await getRecentApprovedRequestEscalation(binding.slot.id, input.userId);
  if (input.ocr.confidence < config.CODE_ACCESS_ESCALATE_BELOW && !adminApproved) {
    if (open?.draftId === input.draftId) {
      return { ok: false, kind: "escalated", reason: "Ảnh vẫn chưa đủ rõ; escalation hiện tại đang chờ admin.", escalationId: open.id };
    }
    const escalation = await createEscalation({
      guildId: input.guildId,
      userId: input.userId,
      kind: "request_low_conf",
      slotId: binding.slot.id,
      draftId: input.draftId,
      payload: { ocr: input.ocr, steamUsername: username, channelId: input.channelId },
      evidenceKeys: input.evidenceKeys,
      now,
    });
    return { ok: false, kind: "escalated", reason: "Ảnh hơi khó đọc nên cần admin xác nhận.", escalationId: escalation.id };
  }

  const flags = evidenceFlags(input.ocr, true, true, now);
  const blockingSet = adminApproved
    ? ["stale_shot", "no_steam_prompt"]
    : ["cropped", "stale_shot", "weak_fingerprint", "no_os_version", "no_steam_prompt", "edited", "unreadable"];
  const blocking = flags.filter((flag) => blockingSet.includes(flag));
  if (blocking.length) return { ok: false, kind: "denied", reason: explainEvidenceFlags(blocking) };

  const os = await enforceOsPolicy({
    slot: binding.slot,
    device: binding.device,
    currentOsVersion: input.ocr.device.osVersion,
    confidence: input.ocr.confidence,
  });
  if (!os.ok) return { ok: false, kind: "denied", reason: "Máy này đã nâng cấp Windows; đăng ký đã bị tạm khoá." };
  if (open?.draftId === input.draftId) await closeOpenEscalationsForDraft(input.draftId);
  return { ok: true, binding, osWarning: os.mismatch, adminApprovedEscalationId: adminApproved?.id };
}
