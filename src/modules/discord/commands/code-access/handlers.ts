import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, MessageFlags, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import { config } from "@config";
import { isAllowedCodeAccessAccount, normalizeSteamUsername } from "../../../code-access/accounts";
import { upsertCodeAccessDraft, updateCodeAccessDraft } from "../../../code-access/drafts";
import { getOpenEscalation } from "../../../code-access/escalations";
import { isSubscriptionActive, listUserSlots } from "../../../code-access/service";
import { isSafeImage, replyAccountNotFound } from "./format";
import { mandatoryWarningEmbed, osUpgradedEmbed, purchaseCheckRow, requestDeviceRow, statusEmbed, supportButton, waitingEmbed } from "./components";

export async function handleCodeAccessInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!config.CODE_ACCESS_ENABLED) {
    await interaction.reply({ content: "Tính năng `/code` đang tắt.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const sub = interaction.options.getSubcommand(true);
  if (sub === "signup") await beginSignup(interaction);
  else if (sub === "request") await beginRequest(interaction);
  else if (sub === "status") await showStatus(interaction);
}

async function beginSignup(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const steamUsername = normalizeSteamUsername(interaction.options.getString("username", true));
  if (!steamUsername || !isAllowedCodeAccessAccount(steamUsername)) return replyAccountNotFound(interaction);
  const purchase = interaction.options.getAttachment("purchase_proof");
  const device = interaction.options.getAttachment("device_info");
  if ((purchase && !isSafeImage(purchase)) || (device && !isSafeImage(device))) {
    await interaction.reply({ content: "File phải là ảnh và mỗi ảnh tối đa 5MB.", flags: MessageFlags.Ephemeral });
    return;
  }
  const slots = await listUserSlots(interaction.guildId, interaction.user.id);
  const draft = await upsertCodeAccessDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    kind: "signup",
    step: "purchase_check",
    payload: {
      steamUsername,
      discordUsername: interaction.user.username,
      channelId: interaction.channelId,
      purchaseProof: serializeAttachment(purchase),
      deviceInfo: serializeAttachment(device),
    },
  });
  const intro = new EmbedBuilder().setTitle(slots.length ? `Bạn đang có ${slots.length} gói` : "Đăng ký gói đầu tiên")
    .setColor(0x5865f2).setDescription("Bạn đã mua tài khoản và hoàn tất cập nhật máy chưa?");
  await interaction.reply({ embeds: [intro, mandatoryWarningEmbed()], components: [purchaseCheckRow(draft.id)], flags: MessageFlags.Ephemeral });
  const message = await interaction.fetchReply();
  await updateCodeAccessDraft({ id: draft.id, userId: interaction.user.id, messageId: message.id });
}

async function beginRequest(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const steamUsername = normalizeSteamUsername(interaction.options.getString("username", true));
  if (!steamUsername || !isAllowedCodeAccessAccount(steamUsername)) return replyAccountNotFound(interaction);
  const slots = await listUserSlots(interaction.guildId, interaction.user.id);
  if (slots.length === 0) {
    await interaction.reply({ content: "Bạn cần đăng ký trước. Hãy gõ `/code signup`.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!slots.some(({ slot }) => slot.steamUsername === steamUsername)) {
    await interaction.reply({
      content: `Bạn không có gói cho account này. Account đang sở hữu: ${slots.map(({ slot }) => `\`${slot.steamUsername}\``).join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const owned = slots.filter(({ slot }) => slot.steamUsername === steamUsername);
  const active = owned.find(({ slot }) => slot.status === "approved" && isSubscriptionActive(slot.subscriptionEnd));
  if (!active) {
    const current = owned[0];
    const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(supportButton())];
    if (current.slot.suspendReason === "os_upgraded") {
      await interaction.reply({ embeds: [osUpgradedEmbed(current.device.osVersionLocked, null)], components, flags: MessageFlags.Ephemeral });
    } else {
      const reason = current.slot.status === "approved" ? `Gói đã hết hạn ngày ${current.slot.subscriptionEnd?.toISOString().slice(0, 10) ?? "—"}.` : `Gói đang ở trạng thái \`${current.slot.status}\`.`;
      await interaction.reply({ content: `⛔ ${reason}`, components, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  if (!config.CODE_ACCESS_ISSUE_CODES) {
    await interaction.reply({ content: "Chức năng phát mã đang tạm dừng; hồ sơ của bạn vẫn được giữ nguyên.", flags: MessageFlags.Ephemeral });
    return;
  }
  const open = await getOpenEscalation({ guildId: interaction.guildId, userId: interaction.user.id });
  if (open) {
    await interaction.reply({ embeds: [waitingEmbed()], flags: MessageFlags.Ephemeral });
    return;
  }
  const draft = await upsertCodeAccessDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    kind: "request",
    step: "choose_device",
    payload: { steamUsername, discordUsername: interaction.user.username, channelId: interaction.channelId },
  });
  const embed = new EmbedBuilder().setTitle("Bạn đang dùng thiết bị gì?").setColor(0x5865f2)
    .setDescription("Chọn loại thiết bị để xem đúng hướng dẫn chụp ảnh.");
  await interaction.reply({ embeds: [embed], components: [requestDeviceRow(draft.id)], flags: MessageFlags.Ephemeral });
  const message = await interaction.fetchReply();
  await updateCodeAccessDraft({ id: draft.id, userId: interaction.user.id, messageId: message.id });
}

async function showStatus(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const slots = await listUserSlots(interaction.guildId, interaction.user.id);
  await interaction.reply({ embeds: [statusEmbed(slots)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

function serializeAttachment(attachment: Attachment | null): Record<string, unknown> | null {
  return attachment ? { url: attachment.url, contentType: attachment.contentType, size: attachment.size, name: attachment.name } : null;
}
