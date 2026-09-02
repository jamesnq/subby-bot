import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import {
  codeAccessEntitlements,
  type CodeAccessEntitlementRow,
} from "../../database/schema";
import type { CodeAccessVerificationResult } from "../verification";
import {
  CODE_ACCESS_ACCOUNT_NOT_FOUND,
  isAllowedCodeAccessAccount,
  normalizeSteamUsername,
} from "../accounts";
import { sameDeviceFingerprint } from "./fingerprint";
import { type CodeAccessDecision, type CodeAccessRequestedCapability, UNSUPPORTED_SECRET_CAPABILITIES } from "./types";

export async function getEntitlement(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const userId = input.userId ?? input.discordUserId;
  if (!userId) throw new Error("userId is required");
  return getCodeAccessEntitlement({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
  });
}

export async function getCodeAccessEntitlement(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
}): Promise<CodeAccessEntitlementRow | undefined> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) return undefined;
  if (!isAllowedCodeAccessAccount(steamUsername)) return undefined;
  const rows = await db
    .select()
    .from(codeAccessEntitlements)
    .where(
      and(
        eq(codeAccessEntitlements.guildId, input.guildId),
        eq(codeAccessEntitlements.userId, input.userId),
        eq(codeAccessEntitlements.steamUsername, steamUsername),
      ),
    )
    .orderBy(desc(codeAccessEntitlements.updatedAt))
    .limit(1);
  return rows[0];
}

export async function requestAccessDecision(input: {
  guildId: string;
  userId?: string;
  discordUserId?: string;
  steamUsername: string;
  requestedCapability?: CodeAccessRequestedCapability;
  deviceVerification?: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessDecision> {
  if (UNSUPPORTED_SECRET_CAPABILITIES.has(input.requestedCapability ?? "manual_code_access")) {
    return {
      ok: false,
      reason: "This service does not retrieve Gmail, MFA/2FA, OTP, login codes, passwords, tokens, or credentials.",
    };
  }

  const userId = input.userId ?? input.discordUserId;
  if (!userId) return { ok: false, reason: "Discord user id is required." };
  return requestCodeAccess({
    guildId: input.guildId,
    userId,
    steamUsername: input.steamUsername,
    deviceVerification: input.deviceVerification,
    now: input.now,
  });
}

export async function requestCodeAccess(input: {
  guildId: string;
  userId: string;
  steamUsername: string;
  deviceVerification?: CodeAccessVerificationResult;
  now?: Date;
}): Promise<CodeAccessDecision> {
  const steamUsername = normalizeSteamUsername(input.steamUsername);
  if (!steamUsername) {
    return { ok: false, reason: "Username Steam không hợp lệ." };
  }
  if (!isAllowedCodeAccessAccount(steamUsername)) {
    return { ok: false, reason: CODE_ACCESS_ACCOUNT_NOT_FOUND };
  }

  const entitlement = await getCodeAccessEntitlement({
    guildId: input.guildId,
    userId: input.userId,
    steamUsername,
  });
  if (!entitlement) {
    return {
      ok: false,
      reason: "Bạn chưa verify quyền sử dụng. Dùng `/code verify` với ảnh mua hàng và ảnh thông tin máy tính fullscreen rõ ngày giờ.",
    };
  }
  if (entitlement.status !== "approved") {
    return {
      ok: false,
      entitlement,
      reason: `Quyền sử dụng đang ở trạng thái \`${entitlement.status}\`, chưa thể xử lý yêu cầu.`,
    };
  }

  const now = input.now ?? new Date();
  if (!entitlement.subscriptionEnd || entitlement.subscriptionEnd.getTime() <= now.getTime()) {
    return {
      ok: false,
      entitlement,
      reason: "Gói sử dụng đã hết hạn. Vui lòng gia hạn và verify lại bằng chứng mua hàng mới.",
    };
  }

  if (input.deviceVerification && !sameDeviceFingerprint(entitlement, input.deviceVerification)) {
    return {
      ok: false,
      entitlement,
      reason: "Thông tin máy tính không khớp với máy đã kích hoạt ban đầu. Mỗi user chỉ được dùng một máy.",
    };
  }

  return {
    ok: true,
    entitlement,
    message: "Bạn đủ điều kiện sử dụng. Vì lý do bảo mật, bot không tự động phát mã đăng nhập; admin sẽ xử lý thủ công qua kênh an toàn.",
  };
}
