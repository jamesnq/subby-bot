import {
  MessageFlags,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../../config";
import { isImageAttachment } from "../../shared/media";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../permissions/guard";
import { CODE_ACCESS_SAFE_RESPONSE, codeAccessSafeReply } from "../../code-access/safety";
import { hitCodeAccessDailyLimit } from "../../code-access/limits";
import {
  adminReviewCodeAccess,
  getCodeAccessEntitlement,
  requestCodeAccess,
  saveVerificationSubmission,
} from "../../code-access/service";
import { verifyCodeAccessScreenshots } from "../../code-access/verification";
import {
  GmailSteamMailError,
  formatSteamCodeLine,
  listSteamCodes,
} from "../../gmail/steam-mail";

export const codeAccessCommand = new SlashCommandBuilder()
  .setName("code")
  .setDescription("Kiểm tra quyền sử dụng account an toàn, không phát mã đăng nhập tự động")
  .addSubcommand((s) =>
    s
      .setName("request")
      .setDescription("Kiểm tra bạn có đủ điều kiện để admin xử lý thủ công không")
      .addStringOption((o) =>
        o.setName("username").setDescription("Steam username/account label").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("verify")
      .setDescription("Gửi ảnh mua hàng và ảnh thông tin máy để verify")
      .addStringOption((o) =>
        o.setName("username").setDescription("Steam username/account label").setRequired(true),
      )
      .addAttachmentOption((o) =>
        o.setName("purchase_proof").setDescription("Ảnh fullscreen bằng chứng mua hàng, rõ ngày giờ").setRequired(true),
      )
      .addAttachmentOption((o) =>
        o.setName("device_info").setDescription("Ảnh fullscreen Windows Settings > About, rõ ngày giờ").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("status")
      .setDescription("Xem trạng thái quyền sử dụng của bạn")
      .addStringOption((o) =>
        o.setName("username").setDescription("Steam username/account label").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("review")
      .setDescription("Admin duyệt/từ chối/revoke quyền sử dụng")
      .addUserOption((o) => o.setName("user").setDescription("User cần review").setRequired(true))
      .addStringOption((o) =>
        o.setName("username").setDescription("Steam username/account label").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("status")
          .setDescription("Trạng thái")
          .setRequired(true)
          .addChoices(
            { name: "approved", value: "approved" },
            { name: "rejected", value: "rejected" },
            { name: "revoked", value: "revoked" },
          ),
      )
      .addIntegerOption((o) =>
        o.setName("days").setDescription("Gia hạn từ hôm nay thêm số ngày này").setMinValue(1).setMaxValue(370),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("steam-email")
      .setDescription("Admin lấy mã Steam Guard mới nhất, dạng `tài khoản: mã`")
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("Số email muốn xem").setMinValue(1).setMaxValue(5),
      )
      .addStringOption((o) =>
        o.setName("query").setDescription("Bộ lọc Gmail bổ sung, ví dụ newer_than:2d subject:Steam"),
      ),
  );

export async function handleCodeAccessInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand(true);
  if (!config.CODE_ACCESS_ENABLED && sub !== "steam-email") {
    await interaction.reply({
      content: "Tính năng `/code` đang tắt. Admin bật `CODE_ACCESS_ENABLED=true` sau khi chuẩn bị quy trình review an toàn.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (sub === "request") {
    await handleRequest(interaction);
  } else if (sub === "verify") {
    await handleVerify(interaction);
  } else if (sub === "status") {
    await handleStatus(interaction);
  } else if (sub === "review") {
    await handleReview(interaction);
  } else if (sub === "steam-email") {
    await handleSteamEmail(interaction);
  }
}

async function handleRequest(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const username = interaction.options.getString("username", true);
  const decision = await requestCodeAccess({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    steamUsername: username,
  });

  if (!decision.ok) {
    await interaction.reply({
      ...codeAccessSafeReply(`⛔ ${decision.reason}\n\n${CODE_ACCESS_SAFE_RESPONSE}`),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    ...codeAccessSafeReply(`✅ ${decision.message}\nHạn dùng tới: ${formatDate(decision.entitlement.subscriptionEnd)}\n\n${CODE_ACCESS_SAFE_RESPONSE}`),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleVerify(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const username = interaction.options.getString("username", true);
  const purchaseProof = interaction.options.getAttachment("purchase_proof", true);
  const deviceInfo = interaction.options.getAttachment("device_info", true);

  if (!isSafeImage(purchaseProof) || !isSafeImage(deviceInfo)) {
    await interaction.reply({
      content: "Cả hai file phải là ảnh screenshot và mỗi ảnh tối đa 5MB.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const limited = hitCodeAccessDailyLimit({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    userLimit: config.CODE_ACCESS_USER_DAILY_LIMIT,
    guildLimit: config.CODE_ACCESS_GUILD_DAILY_LIMIT,
  });
  if (!limited.ok) {
    await interaction.reply({
      content: limited.reason,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const verification = await verifyCodeAccessScreenshots(
    [purchaseProof.url],
    [deviceInfo.url],
    { guildId: interaction.guildId },
  );
  const row = await saveVerificationSubmission({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    steamUsername: username,
    purchaseProofUrl: purchaseProof.url,
    deviceInfoUrl: deviceInfo.url,
    verification,
  });

  const statusLine =
    row.status === "approved"
      ? "✅ Ảnh đủ rõ và quyền sử dụng đã được approve tự động."
      : row.status === "rejected"
        ? "⛔ Ảnh verify bị từ chối, thường do hết hạn hoặc thông tin máy không khớp."
        : "🟡 Đã nhận ảnh verify. Kết quả cần admin review trước khi sử dụng.";

  await interaction.editReply({
    content: [
      statusLine,
      `Trạng thái: \`${row.status}\``,
      `Hạn dùng: ${formatDate(row.subscriptionEnd)}`,
      `Máy đã lưu: ${maskDeviceLabel(row.deviceFingerprintLabel)}`,
      `Độ tin cậy: ${Math.round(verification.confidence * 100)}%`,
      verification.reasons.length ? `Ghi chú: ${verification.reasons.join("; ")}` : null,
      "",
      CODE_ACCESS_SAFE_RESPONSE,
    ].filter(Boolean).join("\n").slice(0, 2000),
    allowedMentions: { parse: [] },
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const username = interaction.options.getString("username", true);
  const row = await getCodeAccessEntitlement({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    steamUsername: username,
  });
  if (!row) {
    await interaction.reply({
      content: "Chưa có hồ sơ verify cho username này. Dùng `/code verify` trước.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.reply({
    content: [
      `Trạng thái: \`${row.status}\``,
      `Hạn dùng: ${formatDate(row.subscriptionEnd)}`,
      `Máy đã kích hoạt: ${maskDeviceLabel(row.deviceFingerprintLabel)}`,
      CODE_ACCESS_SAFE_RESPONSE,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleReview(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({ content: ADMIN_DENY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const username = interaction.options.getString("username", true);
  const status = interaction.options.getString("status", true) as "approved" | "rejected" | "revoked";
  const days = interaction.options.getInteger("days");
  const subscriptionEnd = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : undefined;
  const row = await adminReviewCodeAccess({
    guildId: interaction.guildId,
    userId: user.id,
    steamUsername: username,
    status,
    reviewerId: interaction.user.id,
    subscriptionEnd,
  });

  await interaction.reply({
    content: row
      ? `✅ Đã cập nhật \`${username}\` cho <@${user.id}> thành \`${status}\`. Hạn dùng: ${formatDate(row.subscriptionEnd)}`
      : "Không tìm thấy hồ sơ để review.",
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleSteamEmail(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({ content: ADMIN_DENY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!config.GMAIL_ENABLED) {
    await interaction.reply({
      content: "Gmail đang tắt. Bật `GMAIL_ENABLED=true` và cấu hình OAuth Gmail readonly trong `.env`.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const entries = await listSteamCodes({
      limit: interaction.options.getInteger("limit") ?? 3,
      query: interaction.options.getString("query") ?? undefined,
    });

    await interaction.editReply({
      content: formatSteamCodes(entries),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const message = error instanceof GmailSteamMailError
      ? error.message
      : "Không đọc được Gmail lúc này.";
    await interaction.editReply({
      content: `⛔ ${message}`,
      allowedMentions: { parse: [] },
    });
  }
}

function isSafeImage(att: Attachment): boolean {
  return isImageAttachment({
    url: att.url,
    name: att.name,
    contentType: att.contentType,
    size: att.size,
  }) && att.size <= 5 * 1024 * 1024;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return "chưa xác định";
  return value.toISOString().slice(0, 10);
}

function maskDeviceLabel(label: string | null | undefined): string {
  if (!label) return "chưa lưu";
  return label.replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatSteamCodes(entries: Awaited<ReturnType<typeof listSteamCodes>>): string {
  if (entries.length === 0) {
    return "Không tìm thấy mã Steam nào trong Gmail.";
  }

  return truncateDiscord(entries.map(formatSteamCodeLine).join("\n"), 1_900);
}

function truncateDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
