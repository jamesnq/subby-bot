import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { config } from "@config";
import type { CodeAccessOcrResult } from "../../../code-access/ocr";
import {
  calculateSubscription,
  explainEvidenceFlags,
  type BoundCodeAccessSlot,
} from "../../../code-access/service";
import { formatDate, maskIdentifier, truncateDiscord } from "./format";

export const CA_PREFIX = "ca:";
export const GUIDE_IMAGES = {
  steam: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-steam.png`,
  device: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-device.png`,
  order: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-order.png`,
} as const;

export function mandatoryWarningEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("⚠️ LÀM XONG 3 VIỆC NÀY TRƯỚC KHI ĐĂNG KÝ")
    .setColor(0xed4245)
    .setDescription(
      [
        "1. Cập nhật Windows Update tới khi báo **You're up to date**.",
        "2. Cập nhật driver NVIDIA / AMD / Intel.",
        "3. Khởi động lại máy.",
        "",
        "Sau khi đăng ký, **tuyệt đối không nâng cấp phiên bản Windows** (vd. 25H2 → 26H1). Nâng phiên bản làm mất hiệu lực gói và phải mua lại.",
        "✅ **Chỉ** được cài nếu đó là **bản vá lỗi bảo mật khẩn cấp (critical)** và Microsoft **đã xác nhận chính thức** — bản vá này chỉ đổi số build, không đổi phiên bản.",
        "⛔ Tắt “Get the latest updates as soon as they're available” — đây là nguồn nâng phiên bản tự động, không phải bản vá bảo mật.",
      ].join("\n"),
    );
}

export function signupGuideEmbed(ttlMinutes: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📋 Đăng ký gói và thiết bị")
    .setColor(0x5865f2)
    .setDescription(
      [
        "Gửi **2 ảnh** vào kênh này:",
        "1. Ảnh lịch sử đơn hàng hoặc tin nhắn có bill.",
        "2. Ảnh **toàn màn hình** Settings → System → About, thấy rõ đồng hồ, ngày và dòng Version.",
        "",
        "**Ảnh mẫu:**",
        `🧾 Lịch sử đơn hàng: ${GUIDE_IMAGES.order}`,
        `💻 Settings → System → About: ${GUIDE_IMAGES.device}`,
        "",
        `Bạn có **${ttlMinutes} phút**. Chỉ mình bot, bạn và admin nhìn thấy kênh này.`,
      ].join("\n"),
    );
}

export function signupGuideRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(supportButton());
}

export function confirmationEmbed(input: {
  userId: string;
  username: string;
  ocr: CodeAccessOcrResult;
}): EmbedBuilder {
  const { order, device } = input.ocr;
  const plan =
    order?.planKind === "lifetime"
      ? "Vĩnh viễn"
      : order?.planKind
        ? `${order.planUnits ?? 1} ${order.planKind === "year" ? "năm" : "tháng"}`
        : "—";
  const subscription = order?.planKind
    ? calculateSubscription({
        planKind: order.planKind,
        planUnits: order.planUnits,
        orderPlacedAt: order.orderPlacedAt,
      })
    : null;
  const planDisplay = subscription
    ? `${plan} → ${subscription.end?.toISOString().slice(0, 10) ?? "vĩnh viễn"}`
    : plan;
  return new EmbedBuilder()
    .setTitle("🧾 Xác nhận thông tin đăng ký")
    .setColor(0xfee75c)
    .setDescription(
      truncateDiscord(
        [
          `👤 Discord      <@${input.userId}> (\`${input.username}\`) · id: ${input.userId}`,
          `🧾 Mã đơn hàng  ${order?.orderCode ?? "—"}`,
          `📅 Ngày mua     ${order?.orderPlacedAt ?? "—"}`,
          `📦 Sản phẩm     ${order?.productName ?? "—"}`,
          `⏳ Gói          ${planDisplay}`,
          `💻 Tên máy      ${device.deviceName ?? "—"}`,
          `🆔 Device ID    ${maskIdentifier(device.deviceId)}`,
          `🔑 Product ID   ${maskIdentifier(device.productId)}`,
          `⚙️ Cấu hình     ${[device.processor, device.installedRam, device.graphicsCard].filter(Boolean).join(" · ") || "—"}`,
          `🪟 Windows      ${[device.osEdition, device.osVersion].filter(Boolean).join(" ") || "—"}${device.osBuild ? ` (build ${device.osBuild})` : ""}`,
          device.osVersion
            ? `                🔒 Phiên bản ${device.osVersion} sẽ bị KHOÁ — nâng cấp = mất gói`
            : "",
          `📊 Độ tin cậy   ${Math.round(input.ocr.confidence * 100)}%`,
          `⚠️ Cảnh báo     ${explainEvidenceFlags(input.ocr.flags) || "Không có"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        3900,
      ),
    )
    .setFooter({ text: "Sai thông tin? Bấm “Cần sửa”. Hết hạn sau 15 phút." });
}

export function confirmationRows(
  draftId: string,
  disabled = false,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ca:sg:ok:${draftId}`)
        .setLabel("✅ Đúng")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`ca:sg:edit:${draftId}`)
        .setLabel("✏️ Cần sửa")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ca:sg:cancel:${draftId}`)
        .setLabel("❌ Hủy")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function editFieldRow(
  draftId: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const fields = [
    ["order_code", "Mã đơn hàng"],
    ["order_placed_at", "Ngày mua"],
    ["plan_kind", "Loại gói"],
    ["plan_units", "Số tháng/năm"],
    ["device_name", "Tên máy"],
    ["device_id", "Device ID"],
    ["product_id", "Product ID"],
    ["processor", "CPU"],
    ["os_version", "Windows Version"],
  ];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ca:sg:field:${draftId}`)
      .setPlaceholder("Chọn thông tin cần sửa")
      .addOptions(fields.map(([value, label]) => ({ value, label }))),
  );
}

export function waitingEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🕐 Đang chờ admin xác nhận")
    .setColor(0xfee75c)
    .setDescription(
      "Ảnh của bạn hơi khó đọc nên mình cần admin xem qua. Thường mất vài phút đến vài giờ. Bạn có thể chụp lại ảnh rõ hơn để được tự duyệt.",
    );
}

export function waitingRows(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ca:sg:retry:${draftId}`)
      .setLabel("🔁 Chụp lại ảnh rõ hơn")
      .setStyle(ButtonStyle.Primary),
    supportButton(),
  );
}

export function requestDeviceRow(
  draftId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ca:rq:pc:${draftId}`)
      .setLabel("🖥️ PC / Laptop")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ca:rq:hh:${draftId}`)
      .setLabel("🎮 Handheld")
      .setStyle(ButtonStyle.Secondary),
    supportButton(),
  );
}

export function requestRetryRow(
  draftId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ca:rq:retry:${draftId}`)
      .setLabel("🔁 Chụp lại")
      .setStyle(ButtonStyle.Primary),
    supportButton(),
  );
}

export function statusEmbed(items: BoundCodeAccessSlot[]): EmbedBuilder {
  const lines = items
    .map(({ slot, device }, index) =>
      [
        `**${index + 1}. ${slot.steamUsername}** — \`${slot.status}\``,
        `Máy: ${String(device.deviceJson.deviceName ?? "—")} · ${maskIdentifier(String(device.deviceJson.deviceId ?? ""))}`,
        `Windows: ${device.osEdition ?? "—"} ${device.osVersionLocked ?? "—"} · Hạn: ${formatDate(slot.subscriptionEnd)}`,
        `Slot: \`${slot.id}\``,
      ].join("\n"),
    )
    .join("\n\n");
  return new EmbedBuilder()
    .setTitle("📋 Gói và thiết bị của bạn")
    .setColor(0x5865f2)
    .setDescription(lines || "Bạn chưa có gói nào.");
}

export function osUpgradedEmbed(
  locked: string | null,
  current: string | null,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("⛔ Máy này đã nâng cấp Windows")
    .setColor(0xed4245)
    .setDescription(
      [
        `Phiên bản lúc đăng ký: **${locked ?? "—"}**`,
        `Phiên bản hiện tại: **${current ?? "—"}**`,
        "",
        "Theo điều khoản sử dụng, nâng cấp phiên bản Windows làm mất hiệu lực kích hoạt. Đăng ký đã bị tạm khoá; bạn cần mua lại gói mới.",
        "Chỉ bản vá lỗi bảo mật khẩn cấp được Microsoft xác nhận chính thức (không đổi phiên bản) mới không ảnh hưởng.",
      ].join("\n"),
    );
}

export function supportButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel("💬 Nhắn fanpage")
    .setStyle(ButtonStyle.Link)
    .setURL(config.SUPPORT_FANPAGE_URL);
}
