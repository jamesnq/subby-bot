import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { deleteCodeAccessDraft, updateCodeAccessDraft } from "../../../code-access/drafts";
import type { CodeAccessOcrResult, PlanKind } from "../../../code-access/ocr";
import { runEvidencePipeline } from "../../../code-access/pipeline";
import { hitCodeAccessDailyLimit } from "../../../code-access/limits";
import { config } from "@config";
import { finalizeSignup, missingSignupFields } from "../../../code-access/service";
import { notifyCodeAccessEscalation } from "./escalation";
import {
  confirmationEmbed,
  confirmationRows,
  editFieldRow,
  mandatoryWarningEmbed,
  purchaseGuideRows,
  supportButton,
  waitingEmbed,
  waitingRows,
} from "./components";
import { asObject, asRemoteImage, collectImageMessages, ownedDraft } from "./interaction-utils";

export async function handleSignupButton(interaction: ButtonInteraction, action: string, draftId: string): Promise<void> {
  const draft = await ownedDraft(interaction, draftId, "signup");
  if (!draft) return;
  if (action === "notbought") {
    await interaction.deferUpdate();
    const guide = new EmbedBuilder().setTitle("Chuẩn bị trước khi đăng ký").setColor(0x5865f2).setDescription([
      "1. Ảnh lịch sử đơn hàng hoặc tin nhắn có bill.",
      "2. Ảnh **toàn màn hình** Settings → System → About, thấy đồng hồ, ngày và Version.",
      "3. Chọn đúng account và biết gói: 1 tháng / 1 năm / vĩnh viễn.",
    ].join("\n"));
    await interaction.editReply({ embeds: [guide, mandatoryWarningEmbed()], components: purchaseGuideRows(draft.id) });
    return;
  }
  if (action === "cancel") {
    await interaction.deferUpdate();
    await deleteCodeAccessDraft(draft.id);
    await interaction.editReply({ content: "Đã hủy đăng ký.", embeds: [], components: [] });
    return;
  }
  if (action === "edit") {
    await interaction.deferUpdate();
    await interaction.editReply({ components: [editFieldRow(draft.id)] });
    return;
  }
  if (action === "ok") {
    await confirmSignup(interaction, draft);
    return;
  }
  if (action === "bought" || action === "retry") {
    await collectAndAnalyzeSignup(interaction, draft, action === "retry");
  }
}

async function collectAndAnalyzeSignup(
  interaction: ButtonInteraction,
  draft: Awaited<ReturnType<typeof ownedDraft>> & {},
  forceCollect: boolean,
): Promise<void> {
  await interaction.deferUpdate();
  const payload = asObject(draft.payloadJson);
  let purchase = forceCollect ? null : asRemoteImage(payload.purchaseProof);
  let device = forceCollect ? null : asRemoteImage(payload.deviceInfo);
  try {
    if (!purchase || !device) {
      const missing = Number(!purchase) + Number(!device);
      await interaction.editReply({
        content: `Gửi ${missing} ảnh còn thiếu vào channel này trong 10 phút. ${!purchase && !device ? "Gửi bill trước, ảnh máy sau." : ""}`,
        embeds: [], components: [],
      });
      const received = await collectImageMessages(interaction, missing);
      if (!purchase) purchase = received.shift() ?? null;
      if (!device) device = received.shift() ?? null;
    }
    if (!purchase || !device) throw new Error("Chưa nhận đủ hai ảnh");
    const limited = await hitCodeAccessDailyLimit({
      guildId: draft.guildId, userId: draft.userId, userLimit: config.CODE_ACCESS_USER_DAILY_LIMIT,
      guildLimit: config.CODE_ACCESS_GUILD_DAILY_LIMIT, scope: "signup",
    });
    if (!limited.ok) {
      await interaction.editReply({ content: limited.reason, embeds: [], components: [] });
      return;
    }
    await interaction.editReply({ content: "Đang nén, lưu riêng tư và đọc hai ảnh…", embeds: [], components: [] });
    const result = await runEvidencePipeline({
      guildId: draft.guildId,
      userId: draft.userId,
      mode: "signup",
      items: [{ kind: "order", image: purchase }, { kind: "device", image: device }],
    });
    const nextPayload = {
      steamUsername: String(payload.steamUsername ?? ""),
      discordUsername: String(payload.discordUsername ?? interaction.user.username),
      channelId: String(payload.channelId ?? interaction.channelId ?? ""),
      ocr: result.ocr,
      evidence: {
        purchaseProofS3Key: result.evidence[0].s3Key,
        purchaseProofSha256: result.evidence[0].sha256,
        deviceInfoS3Key: result.evidence[1].s3Key,
        deviceInfoSha256: result.evidence[1].sha256,
      },
    };
    await updateCodeAccessDraft({ id: draft.id, userId: draft.userId, step: "confirm", payload: nextPayload });
    const missingFields = missingSignupFields(result.ocr);
    await interaction.editReply({
      content: missingFields.length ? `Thiếu trường bắt buộc: ${missingFields.join(", ")}. Bấm “Cần sửa” để nhập tay.` : null,
      embeds: [confirmationEmbed({ userId: draft.userId, username: String(nextPayload.discordUsername), ocr: result.ocr })],
      components: confirmationRows(draft.id, missingFields.length > 0),
    });
  } catch (error) {
    await interaction.editReply({
      content: `⛔ ${error instanceof Error ? error.message : "Không xử lý được ảnh"}\nHãy chạy lại \`/code signup\` hoặc liên hệ fanpage.`,
      embeds: [], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(supportButton())],
    });
  }
}

async function confirmSignup(interaction: ButtonInteraction, draft: NonNullable<Awaited<ReturnType<typeof ownedDraft>>>): Promise<void> {
  await interaction.deferUpdate();
  const payload = asObject(draft.payloadJson);
  const ocr = payload.ocr as CodeAccessOcrResult | undefined;
  const evidence = asObject(payload.evidence);
  if (!ocr || !evidence.purchaseProofS3Key || !evidence.deviceInfoS3Key) {
    await interaction.editReply({ content: "Phiên xác nhận thiếu dữ liệu; hãy chụp lại ảnh.", embeds: [], components: [waitingRows(draft.id)] });
    return;
  }
  const result = await finalizeSignup({
    guildId: draft.guildId, userId: draft.userId,
    discordUsername: String(payload.discordUsername ?? interaction.user.username), steamUsername: String(payload.steamUsername ?? ""),
    draftId: draft.id, ocr,
    channelId: String(payload.channelId ?? interaction.channelId ?? ""),
    evidence: {
      purchaseProofS3Key: String(evidence.purchaseProofS3Key), purchaseProofSha256: String(evidence.purchaseProofSha256),
      deviceInfoS3Key: String(evidence.deviceInfoS3Key), deviceInfoSha256: String(evidence.deviceInfoSha256),
    },
  });
  if (result.kind === "missing_fields") {
    await interaction.editReply({ content: `Thiếu trường bắt buộc: ${result.fields.join(", ")}.`, components: confirmationRows(draft.id, true) });
    return;
  }
  if (result.kind === "invalid_evidence") {
    await interaction.editReply({ content: `Ảnh chưa đạt yêu cầu: ${result.flags.join(", ")}. Hãy chụp lại ảnh toàn màn hình và rõ giờ/ngày.`, embeds: [], components: [waitingRows(draft.id)] });
    return;
  }
  if (result.kind === "escalated") {
    await notifyCodeAccessEscalation(result.escalationId).catch(() => undefined);
    await interaction.editReply({ content: null, embeds: [waitingEmbed()], components: [waitingRows(draft.id)] });
    return;
  }
  await deleteCodeAccessDraft(draft.id);
  const done = new EmbedBuilder().setTitle("✅ Đăng ký thành công").setColor(0x57f287)
    .setDescription(`Account \`${result.slot.steamUsername}\` đã gắn với máy này. Hạn: ${result.slot.subscriptionEnd?.toISOString().slice(0, 10) ?? "vĩnh viễn"}.`);
  await interaction.editReply({ content: null, embeds: [done, mandatoryWarningEmbed()], components: [] });
}

export async function handleSignupFieldSelect(interaction: StringSelectMenuInteraction, draftId: string): Promise<void> {
  const draft = await ownedDraft(interaction, draftId, "signup");
  if (!draft) return;
  const field = interaction.values[0];
  const ocr = asObject(asObject(draft.payloadJson).ocr) as unknown as CodeAccessOcrResult;
  const input = new TextInputBuilder().setCustomId("value").setLabel(field.replaceAll("_", " ").slice(0, 45))
    .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(128);
  const current = getEditableValue(ocr, field);
  if (current) input.setValue(current.slice(0, 128));
  const modal = new ModalBuilder().setCustomId(`ca:sg:modal:${draft.id}:${field}`).setTitle("Sửa thông tin OCR")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleSignupModal(interaction: ModalSubmitInteraction, draftId: string, field: string): Promise<void> {
  const draft = await ownedDraft(interaction, draftId, "signup");
  if (!draft) return;
  const payload = asObject(draft.payloadJson);
  const ocr = structuredClone(payload.ocr) as CodeAccessOcrResult;
  if (!ocr?.device) {
    await interaction.reply({ content: "Không còn dữ liệu OCR để sửa.", flags: MessageFlags.Ephemeral });
    return;
  }
  setEditableValue(ocr, field, interaction.fields.getTextInputValue("value"));
  await updateCodeAccessDraft({ id: draft.id, userId: draft.userId, step: "confirm", payload: { ...payload, ocr } });
  await interaction.deferUpdate();
  const missing = missingSignupFields(ocr);
  await interaction.editReply({
    content: missing.length ? `Còn thiếu: ${missing.join(", ")}` : null,
    embeds: [confirmationEmbed({ userId: draft.userId, username: String(payload.discordUsername ?? interaction.user.username), ocr })],
    components: confirmationRows(draft.id, missing.length > 0),
  });
}

function getEditableValue(ocr: CodeAccessOcrResult, field: string): string {
  const map: Record<string, unknown> = {
    order_code: ocr.order?.orderCode, order_placed_at: ocr.order?.orderPlacedAt, plan_kind: ocr.order?.planKind,
    plan_units: ocr.order?.planUnits, device_name: ocr.device.deviceName, device_id: ocr.device.deviceId,
    product_id: ocr.device.productId, processor: ocr.device.processor, os_version: ocr.device.osVersion,
  };
  return map[field] == null ? "" : String(map[field]);
}

function setEditableValue(ocr: CodeAccessOcrResult, field: string, raw: string): void {
  const value = raw.trim();
  ocr.order ??= { orderCode: null, orderPlacedAt: null, orderSource: "other", orderTotalText: null, productName: null, planKind: null, planUnits: null };
  if (field === "order_code") ocr.order.orderCode = value;
  else if (field === "order_placed_at") ocr.order.orderPlacedAt = value;
  else if (field === "plan_kind" && ["month", "year", "lifetime"].includes(value)) ocr.order.planKind = value as PlanKind;
  else if (field === "plan_units") ocr.order.planUnits = Number.isFinite(Number(value)) ? Math.max(1, Number(value)) : null;
  else if (field === "device_name") ocr.device.deviceName = value;
  else if (field === "device_id") ocr.device.deviceId = value;
  else if (field === "product_id") ocr.device.productId = value;
  else if (field === "processor") ocr.device.processor = value;
  else if (field === "os_version") ocr.device.osVersion = value;
}
