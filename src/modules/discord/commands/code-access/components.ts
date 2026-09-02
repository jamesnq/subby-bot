import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from "discord.js";
import { config } from "@config";
import type { CodeAccessOcrResult } from "../../../code-access/ocr";
import { calculateSubscription, type BoundCodeAccessSlot } from "../../../code-access/service";
import { formatDate, maskIdentifier, truncateDiscord } from "./format";

export const CA_PREFIX = "ca:";
export const STORE_URL = "https://subgamezone.com/products/tai-khoan-steam-offline-nhieu-games";
export const GUIDE_IMAGES = {
  steam: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-steam.jpg`,
  device: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-device.jpg`,
  order: `${config.S3_ENDPOINT.replace(/\/$/, "")}/${config.S3_BUCKET}/guide/code-access-order.jpg`,
} as const;

export function mandatoryWarningEmbed(): EmbedBuilder {
  return new EmbedBuilder().setTitle("⚠️ LÀM XONG 3 VIỆC NÀY TRƯỚC KHI ĐĂNG KÝ").setColor(0xed4245).setDescription([
    "1. Cập nhật Windows Update tới khi báo **You're up to date**.", "2. Cập nhật driver NVIDIA / AMD / Intel.", "3. Khởi động lại máy.", "",
    "Sau khi đăng ký, **không nâng cấp phiên bản Windows** (vd. 25H2 → 26H1). Nâng phiên bản làm mất hiệu lực gói và phải mua lại.",
    "✅ Bản vá bảo mật hằng tháng (chỉ đổi build) vẫn cài bình thường.", "⛔ Tắt “Get the latest updates as soon as they're available”.",
  ].join("\n"));
}

export function purchaseCheckRow(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ca:sg:bought:${draftId}`).setLabel("✅ Đã mua").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ca:sg:notbought:${draftId}`).setLabel("🛒 Chưa mua").setStyle(ButtonStyle.Secondary), helpButton("signup"),
  );
}

export function purchaseGuideRows(draftId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("🛒 Mua tài khoản").setStyle(ButtonStyle.Link).setURL(STORE_URL),
    new ButtonBuilder().setCustomId(`ca:sg:bought:${draftId}`).setLabel("🔄 Tôi đã mua xong").setStyle(ButtonStyle.Success), supportButton(),
  )];
}

export function confirmationEmbed(input: { userId: string; username: string; ocr: CodeAccessOcrResult }): EmbedBuilder {
  const { order, device } = input.ocr;
  const plan = order?.planKind === "lifetime" ? "Vĩnh viễn" : order?.planKind ? `${order.planUnits ?? 1} ${order.planKind === "year" ? "năm" : "tháng"}` : "—";
  const subscription = order?.planKind ? calculateSubscription({ planKind: order.planKind, planUnits: order.planUnits, orderPlacedAt: order.orderPlacedAt }) : null;
  const planDisplay = subscription ? `${plan} → ${subscription.end?.toISOString().slice(0, 10) ?? "vĩnh viễn"}` : plan;
  return new EmbedBuilder().setTitle("🧾 Xác nhận thông tin đăng ký").setColor(0xfee75c).setDescription(truncateDiscord([
    `👤 Discord      <@${input.userId}> (\`${input.username}\`) · id: ${input.userId}`, `🧾 Mã đơn hàng  ${order?.orderCode ?? "—"}`,
    `📅 Ngày mua     ${order?.orderPlacedAt ?? "—"}`, `📦 Sản phẩm     ${order?.productName ?? "—"}`, `⏳ Gói          ${planDisplay}`,
    `💻 Tên máy      ${device.deviceName ?? "—"}`, `🆔 Device ID    ${maskIdentifier(device.deviceId)}`, `🔑 Product ID   ${maskIdentifier(device.productId)}`,
    `⚙️ Cấu hình     ${[device.processor, device.installedRam, device.graphicsCard].filter(Boolean).join(" · ") || "—"}`,
    `🪟 Windows      ${[device.osEdition, device.osVersion].filter(Boolean).join(" ") || "—"}${device.osBuild ? ` (build ${device.osBuild})` : ""}`,
    device.osVersion ? `                🔒 Phiên bản ${device.osVersion} sẽ bị KHOÁ — nâng cấp = mất gói` : "",
    `📊 Độ tin cậy   ${Math.round(input.ocr.confidence * 100)}%`, `⚠️ Cảnh báo     ${input.ocr.flags.join(", ") || "Không có"}`,
  ].filter(Boolean).join("\n"), 3900)).setFooter({ text: "Sai thông tin? Bấm “Cần sửa”. Hết hạn sau 15 phút." });
}

export function confirmationRows(draftId: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ca:sg:ok:${draftId}`).setLabel("✅ Đúng").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`ca:sg:edit:${draftId}`).setLabel("✏️ Cần sửa").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ca:sg:cancel:${draftId}`).setLabel("❌ Hủy").setStyle(ButtonStyle.Secondary),
  )];
}

export function editFieldRow(draftId: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const fields = [["order_code", "Mã đơn hàng"], ["order_placed_at", "Ngày mua"], ["plan_kind", "Loại gói"], ["plan_units", "Số tháng/năm"],
    ["device_name", "Tên máy"], ["device_id", "Device ID"], ["product_id", "Product ID"], ["processor", "CPU"], ["os_version", "Windows Version"]];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`ca:sg:field:${draftId}`)
    .setPlaceholder("Chọn thông tin cần sửa").addOptions(fields.map(([value, label]) => ({ value, label }))));
}

export function waitingEmbed(): EmbedBuilder {
  return new EmbedBuilder().setTitle("🕐 Đang chờ admin xác nhận").setColor(0xfee75c).setDescription("Ảnh của bạn hơi khó đọc nên mình cần admin xem qua. Thường mất vài phút đến vài giờ. Bạn có thể chụp lại ảnh rõ hơn để được tự duyệt.");
}

export function waitingRows(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`ca:sg:retry:${draftId}`).setLabel("🔁 Chụp lại ảnh rõ hơn").setStyle(ButtonStyle.Primary), supportButton());
}

export function requestDeviceRow(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ca:rq:pc:${draftId}`).setLabel("🖥️ PC / Laptop").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ca:rq:hh:${draftId}`).setLabel("🎮 Handheld").setStyle(ButtonStyle.Secondary), helpButton("request"),
  );
}

export function requestRetryRow(draftId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ca:rq:retry:${draftId}`).setLabel("🔁 Chụp lại").setStyle(ButtonStyle.Primary), supportButton(),
  );
}

export function statusEmbed(items: BoundCodeAccessSlot[]): EmbedBuilder {
  const lines = items.map(({ slot, device }, index) => [`**${index + 1}. ${slot.steamUsername}** — \`${slot.status}\``,
    `Máy: ${String(device.deviceJson.deviceName ?? "—")} · ${maskIdentifier(String(device.deviceJson.deviceId ?? ""))}`,
    `Windows: ${device.osEdition ?? "—"} ${device.osVersionLocked ?? "—"} · Hạn: ${formatDate(slot.subscriptionEnd)}`, `Slot: \`${slot.id}\``].join("\n")).join("\n\n");
  return new EmbedBuilder().setTitle("📋 Gói và thiết bị của bạn").setColor(0x5865f2).setDescription(lines || "Bạn chưa có gói nào.");
}

export function osUpgradedEmbed(locked: string | null, current: string | null): EmbedBuilder {
  return new EmbedBuilder().setTitle("⛔ Máy này đã nâng cấp Windows").setColor(0xed4245).setDescription([
    `Phiên bản lúc đăng ký: **${locked ?? "—"}**`, `Phiên bản hiện tại: **${current ?? "—"}**`, "",
    "Theo điều khoản sử dụng, nâng cấp phiên bản Windows làm mất hiệu lực kích hoạt. Đăng ký đã bị tạm khoá; bạn cần mua lại gói mới.",
    "Bản vá bảo mật hằng tháng không ảnh hưởng.",
  ].join("\n"));
}

export function supportButton(): ButtonBuilder { return new ButtonBuilder().setLabel("💬 Nhắn fanpage").setStyle(ButtonStyle.Link).setURL(config.SUPPORT_FANPAGE_URL); }
function helpButton(topic: string): ButtonBuilder { return new ButtonBuilder().setCustomId(`ca:help:${topic}`).setLabel("📖 Hướng dẫn đầy đủ").setStyle(ButtonStyle.Secondary); }
