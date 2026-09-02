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
import { explainEvidenceFlags, finalizeSignup, missingSignupFields } from "../../../code-access/service";
import { notifyCodeAccessEscalation } from "./escalation";
import { closeCodeThread } from "./threads";
import {
  confirmationEmbed,
  confirmationRows,
  editFieldRow,
  mandatoryWarningEmbed,
  supportButton,
  waitingEmbed,
  waitingRows,
} from "./components";
import { asObject, collectImageMessages, ownedDraft, replyTarget, type EditableReply } from "./interaction-utils";

export async function handleSignupButton(interaction: ButtonInteraction, action: string, draftId: string): Promise<void> {
  const draft = await ownedDraft(interaction, draftId, "signup");
  if (!draft) return;
  if (action === "cancel") {
    await interaction.deferUpdate();
    await deleteCodeAccessDraft(draft.id);
    await interaction.editReply({ content: "Đã hủy đăng ký.", embeds: [], components: [] });
    if (interaction.channel?.isThread()) {
      await closeCodeThread({ thread: interaction.channel, summary: "🚫 Đăng ký đã bị hủy." });
    }
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
  if (action === "retry") {
    await interaction.deferUpdate();
    const channel = interaction.channel;
    if (!channel) return;
    try {
      await interaction.editReply({ content: `Gửi 2 ảnh mới (bill + máy) vào kênh này trong ${config.CODE_ACCESS_THREAD_TTL_MINUTES} phút.`, embeds: [], components: [] });
      const [purchase, device] = await collectImageMessages(channel, draft.userId, 2);
      await runSignupEvidencePipeline(replyTarget(interaction), draft, purchase, device);
    } catch (error) {
      await interaction.editReply({
        content: `⛔ ${error instanceof Error ? error.message : "Không xử lý được ảnh"}\nHãy chạy lại \`/code signup\` hoặc liên hệ fanpage.`,
        embeds: [], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(supportButton())],
      });
    }
  }
}

/**
 * Runs the OCR/evidence pipeline for a signup draft and replies with the
 * confirmation embed (or an error). `target` abstracts over how the caller
 * can update its message: a plain Message when this runs right after the
 * thread's opening guide (no button click has happened yet — handlers.ts and
 * the initial image-collection flow in this file both go this route), or a
 * button interaction (the "🔁 Chụp lại" retry path, above).
 */
export async function runSignupEvidencePipeline(
  target: EditableReply,
  draft: NonNullable<Awaited<ReturnType<typeof ownedDraft>>>,
  purchase: { url: string; contentType?: string | null; size?: number },
  device: { url: string; contentType?: string | null; size?: number },
): Promise<void> {
  const payload = asObject(draft.payloadJson);
  try {
    const limited = await hitCodeAccessDailyLimit({
      guildId: draft.guildId, userId: draft.userId, userLimit: config.CODE_ACCESS_USER_DAILY_LIMIT,
      guildLimit: config.CODE_ACCESS_GUILD_DAILY_LIMIT, scope: "signup",
    });
    if (!limited.ok) {
      await target.edit({ content: limited.reason, embeds: [], components: [] });
      return;
    }
    await target.edit({ content: "Đang nén, lưu riêng tư và đọc hai ảnh…", embeds: [], components: [] });
    const result = await runEvidencePipeline({
      guildId: draft.guildId,
      userId: draft.userId,
      mode: "signup",
      items: [{ kind: "order", image: purchase }, { kind: "device", image: device }],
    });
    const nextPayload = {
      steamUsername: String(payload.steamUsername ?? ""),
      discordUsername: String(payload.discordUsername ?? ""),
      channelId: String(payload.channelId ?? ""),
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
    await target.edit({
      content: missingFields.length ? `Thiếu trường bắt buộc: ${missingFields.join(", ")}. Bấm “Cần sửa” để nhập tay.` : null,
      embeds: [confirmationEmbed({ userId: draft.userId, username: String(nextPayload.discordUsername), ocr: result.ocr })],
      components: confirmationRows(draft.id, missingFields.length > 0),
    });
  } catch (error) {
    await target.edit({
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
    await interaction.editReply({ content: `⛔ Ảnh chưa đạt yêu cầu: ${explainEvidenceFlags(result.flags)}.`, embeds: [], components: [waitingRows(draft.id)] });
    return;
  }
  if (result.kind === "escalated") {
    await notifyCodeAccessEscalation(result.escalationId).catch(() => undefined);
    await interaction.editReply({ content: null, embeds: [waitingEmbed()], components: [waitingRows(draft.id)] });
    return;
  }
  await deleteCodeAccessDraft(draft.id);
  const done = new EmbedBuilder().setTitle("✅ Đăng ký thành công").setColor(0x57f287)
    .setDescription([
      `Account \`${result.slot.steamUsername}\` đã gắn với máy này. Hạn: ${result.slot.subscriptionEnd?.toISOString().slice(0, 10) ?? "vĩnh viễn"}.`,
      "", "Dùng `/code request` **ngay trong kênh này** để lấy mã Steam Guard — bạn không cần mở lại kênh mới.",
    ].join("\n"));
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
