import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { presignUserAttachment } from "@infra/storage/s3";
import { getDiscordClient } from "@infra/discord/client";
import { logger } from "@shared/logger";
import { writeAudit } from "../../../database/audit";
import { deleteCodeAccessDraft } from "../../../code-access/drafts";
import {
  decideEscalation,
  getEscalation,
  setEscalationMessageId,
  updateEscalationPayload,
} from "../../../code-access/escalations";
import type { CodeAccessOcrResult } from "../../../code-access/ocr";
import { explainEvidenceFlags, finalizeSignup, type BoundCodeAccessSlot } from "../../../code-access/service";
import { getGuildSettings, isAdminMember, isAdminUser } from "../../permissions/guard";
import { config } from "@config";
import { asObject } from "./interaction-utils";
import { addAdminToThread } from "./threads";

export async function notifyCodeAccessEscalation(id: string): Promise<void> {
  const escalation = await getEscalation(id);
  if (!escalation || escalation.status !== "open" || escalation.adminMsgId) return;
  const client = getDiscordClient();
  const settings = await getGuildSettings(escalation.guildId);
  const payload = asObject(escalation.payloadJson);
  const ocr = payload.ocr as CodeAccessOcrResult | undefined;
  const content = settings.modRoleId ? `<@&${settings.modRoleId}>` : undefined;
  const messagePayload = {
    content,
    embeds: [adminEscalationEmbed(escalation.kind, escalation.userId, ocr, payload)],
    components: [adminEscalationRow(escalation.id, escalation.evidenceKeys.length)],
    allowedMentions: { roles: settings.modRoleId ? [settings.modRoleId] : [] },
  };
  let messageId: string | undefined;
  if (settings.modLogChannelId) {
    const channel = await client.channels.fetch(settings.modLogChannelId).catch(() => null);
    if (channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
      messageId = (await (channel as TextChannel).send(messagePayload)).id;
    }
  }
  if (!messageId) {
    const admin = await client.users.fetch(config.ADMIN_DISCORD_ID).catch(() => null);
    messageId = (await admin?.send({ ...messagePayload, content: undefined, allowedMentions: { parse: [] } }).catch(() => null))?.id;
  }
  // "Ping admin vào" — pull the primary admin into the thread itself (private
  // threads are invisible to non-members without Manage Threads) and drop a
  // short, secret-free pointer there so both the user and the admin see the
  // handoff without duplicating the full OCR detail already in mod-log.
  const threadId = String(payload.channelId ?? "");
  if (threadId) {
    const channel = await client.channels.fetch(threadId).catch(() => null);
    if (channel?.isThread()) {
      await addAdminToThread(channel, config.ADMIN_DISCORD_ID);
      await channel.send({ content: "🔔 Đã gửi yêu cầu cho admin xác nhận. Vui lòng chờ trong kênh này." }).catch((err) => logger.warn({ err, threadId }, "code-access: could not post escalation pointer"));
    }
  }
  if (messageId) await setEscalationMessageId(escalation.id, messageId);
  else await writeAudit({
    guildId: escalation.guildId, actorId: "system", actorType: "system",
    action: "code_access.escalation_delivery_failed", status: "failed", targetType: "code_access_escalation", targetId: escalation.id,
  });
}

export async function notifyOsMismatchWarning(binding: BoundCodeAccessSlot, ocr: CodeAccessOcrResult): Promise<void> {
  const client = getDiscordClient();
  const settings = await getGuildSettings(binding.slot.guildId);
  if (!settings.modLogChannelId) return;
  const channel = await client.channels.fetch(settings.modLogChannelId).catch(() => null);
  if (!channel || !("send" in channel)) return;
  await channel.send({
    embeds: [new EmbedBuilder().setTitle("⚠️ Theo dõi Windows mismatch (warn mode)").setColor(0xfee75c).addFields(
      { name: "User", value: `<@${binding.slot.userId}>`, inline: true },
      { name: "Slot", value: binding.slot.id, inline: true },
      { name: "Version", value: `${binding.device.osVersionLocked ?? "—"} → ${ocr.device.osVersion ?? "—"}`, inline: true },
      { name: "Confidence", value: `${Math.round(ocr.confidence * 100)}%`, inline: true },
    )], allowedMentions: { parse: [] },
  });
}

export async function handleEscalationButton(interaction: ButtonInteraction, action: string, id: string, extra?: string): Promise<void> {
  const admin = interaction.inCachedGuild() ? isAdminMember(interaction.member) : isAdminUser(interaction.user.id);
  if (!admin) {
    await interaction.reply({ content: "⛔ Chỉ admin có thể xử lý.", flags: MessageFlags.Ephemeral });
    return;
  }
  const escalation = await getEscalation(id);
  if (!escalation || escalation.status !== "open") {
    await interaction.reply({ content: "Yêu cầu đã hết hạn hoặc được xử lý.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.guildId && interaction.guildId !== escalation.guildId) return;
  if (action === "img") {
    const key = escalation.evidenceKeys[Number(extra ?? "0")];
    if (!key) {
      await interaction.reply({ content: "Không tìm thấy ảnh.", flags: MessageFlags.Ephemeral });
      return;
    }
    const url = await presignUserAttachment(key);
    await interaction.reply({ content: `[🖼️ Mở ảnh bằng chứng](${url}) — link hết hạn sau 15 phút.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "fix") {
    await interaction.showModal(buildAdminFixModal(escalation.id, asObject(escalation.payloadJson).ocr as CodeAccessOcrResult | undefined));
    return;
  }
  await interaction.deferUpdate();
  if (action === "no") {
    await decideEscalation({ id, adminId: interaction.user.id, status: "rejected" });
    await finalizeAdminMessage(interaction, "⛔ Đã từ chối", interaction.user.id);
    await notifyUser(escalation.userId, "⛔ Yêu cầu `/code` của bạn đã bị admin từ chối. Hãy chụp lại ảnh rõ hơn hoặc liên hệ fanpage.", String(asObject(escalation.payloadJson).channelId ?? ""));
    return;
  }
  await approveEscalation(interaction, escalation, interaction.user.id);
}

export async function handleEscalationFixModal(interaction: ModalSubmitInteraction, id: string): Promise<void> {
  const admin = interaction.inCachedGuild() ? isAdminMember(interaction.member) : isAdminUser(interaction.user.id);
  if (!admin) {
    await interaction.reply({ content: "⛔ Chỉ admin có thể xử lý.", flags: MessageFlags.Ephemeral });
    return;
  }
  const escalation = await getEscalation(id);
  if (!escalation || escalation.status !== "open") {
    await interaction.reply({ content: "Yêu cầu đã hết hạn hoặc được xử lý.", flags: MessageFlags.Ephemeral });
    return;
  }
  const payload = asObject(escalation.payloadJson);
  const ocr = structuredClone(payload.ocr) as CodeAccessOcrResult;
  if (ocr?.device) {
    ocr.order ??= { orderCode: null, orderPlacedAt: null, orderSource: "other", orderTotalText: null, productName: null, planKind: null, planUnits: null };
    ocr.order.orderCode = nullable(interaction.fields.getTextInputValue("orderCode"));
    const planKind = interaction.fields.getTextInputValue("planKind").trim();
    if (["month", "year", "lifetime"].includes(planKind)) ocr.order.planKind = planKind as "month" | "year" | "lifetime";
    ocr.device.deviceName = nullable(interaction.fields.getTextInputValue("deviceName"));
    ocr.device.deviceId = nullable(interaction.fields.getTextInputValue("deviceId"));
    ocr.device.osVersion = nullable(interaction.fields.getTextInputValue("osVersion"));
    payload.ocr = ocr;
    await updateEscalationPayload(id, payload);
  }
  await interaction.deferUpdate();
  await approveEscalation(interaction, { ...escalation, payloadJson: payload }, interaction.user.id);
}

async function approveEscalation(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  escalation: NonNullable<Awaited<ReturnType<typeof getEscalation>>>,
  adminId: string,
): Promise<void> {
  const payload = asObject(escalation.payloadJson);
  try {
    if (escalation.kind === "signup_low_conf" || escalation.kind === "fraud_flag") {
      const result = await finalizeSignup({
        guildId: escalation.guildId, userId: escalation.userId, discordUsername: String(payload.discordUsername ?? "unknown"),
        steamUsername: String(payload.steamUsername ?? ""), draftId: escalation.draftId ?? "", ocr: payload.ocr as CodeAccessOcrResult,
        evidence: asObject(payload.evidence) as never, adminOverrideId: adminId,
      });
      if (result.kind !== "approved") throw new Error(result.kind === "missing_fields" ? `Thiếu: ${result.fields.join(", ")}` : result.kind === "invalid_evidence" ? `Ảnh lỗi: ${explainEvidenceFlags(result.flags)}` : "Không thể duyệt");
      if (escalation.draftId) await deleteCodeAccessDraft(escalation.draftId);
    }
    await decideEscalation({ id: escalation.id, adminId, status: "approved" });
    await finalizeAdminMessage(interaction, "✅ Đã duyệt", adminId);
    const suffix = escalation.kind === "request_low_conf" ? " Hãy chạy lại `/code request`; lượt kế tiếp sẽ dùng quyết định admin này." : " Gói đã được kích hoạt.";
    await notifyUser(escalation.userId, `✅ Admin đã duyệt yêu cầu \`/code\` của bạn.${suffix}`, String(payload.channelId ?? ""));
  } catch (error) {
    await interaction.followUp({ content: `⛔ Không thể duyệt: ${error instanceof Error ? error.message : "lỗi không xác định"}`, flags: MessageFlags.Ephemeral });
  }
}

function adminEscalationEmbed(kind: string, userId: string, ocr: CodeAccessOcrResult | undefined, payload: Record<string, unknown>): EmbedBuilder {
  return new EmbedBuilder().setTitle(`🔍 Cần admin xác nhận — độ tin cậy ${Math.round((ocr?.confidence ?? 0) * 100)}%`).setColor(0xfee75c).addFields(
    { name: "Người dùng", value: `<@${userId}>`, inline: true }, { name: "Loại", value: kind, inline: true },
    { name: "Lý do", value: Array.isArray(payload.fraudFlags) ? payload.fraudFlags.join(", ") : "OCR confidence thấp" },
    { name: "Máy", value: `${ocr?.device.deviceName ?? "—"} · ${ocr?.device.deviceId ?? "—"}`.slice(0, 1024) },
    { name: "Windows", value: `${ocr?.device.osEdition ?? "—"} ${ocr?.device.osVersion ?? "—"} (${ocr?.device.osBuild ?? "—"})` },
    { name: "Cảnh báo", value: (ocr && explainEvidenceFlags(ocr.flags)) || "—" },
  );
}

function adminEscalationRow(id: string, imageCount: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < Math.min(imageCount, 2); i++) row.addComponents(new ButtonBuilder().setCustomId(`ca:es:img:${id}:${i}`).setLabel(`🖼️ Ảnh ${i + 1}`).setStyle(ButtonStyle.Secondary));
  return row.addComponents(
    new ButtonBuilder().setCustomId(`ca:es:ok:${id}`).setLabel("✅ Duyệt").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ca:es:no:${id}`).setLabel("⛔ Từ chối").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ca:es:fix:${id}`).setLabel("✏️ Sửa rồi duyệt").setStyle(ButtonStyle.Primary),
  );
}

function buildAdminFixModal(id: string, ocr?: CodeAccessOcrResult): ModalBuilder {
  const fields = [
    ["orderCode", "Mã đơn", ocr?.order?.orderCode], ["planKind", "Gói: month / year / lifetime", ocr?.order?.planKind],
    ["deviceName", "Tên máy", ocr?.device.deviceName], ["deviceId", "Device ID", ocr?.device.deviceId], ["osVersion", "Windows Version", ocr?.device.osVersion],
  ] as const;
  return new ModalBuilder().setCustomId(`ca:es:modal:${id}`).setTitle("Sửa OCR và duyệt").addComponents(...fields.map(([key, label, value]) => {
    const input = new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(128);
    if (value) input.setValue(String(value).slice(0, 128));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  }));
}

async function finalizeAdminMessage(interaction: ButtonInteraction | ModalSubmitInteraction, label: string, adminId: string): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("ca:processed").setLabel(`${label} bởi ${adminId}`).setStyle(ButtonStyle.Secondary).setDisabled(true));
  await interaction.editReply({ components: [row] });
}

async function notifyUser(userId: string, content: string, channelId?: string): Promise<void> {
  const user = await getDiscordClient().users.fetch(userId).catch(() => null);
  const sent = await user?.send({ content: `${content}\n${config.SUPPORT_FANPAGE_URL}`, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
  if (sent || !channelId) return;
  const channel = await getDiscordClient().channels.fetch(channelId).catch(() => null);
  if (channel && !channel.isDMBased() && "send" in channel) {
    await channel.send({ content: `<@${userId}> ${content}`, allowedMentions: { users: [userId] } }).catch(() => undefined);
  }
}

function nullable(value: string): string | null { return value.trim() || null; }
