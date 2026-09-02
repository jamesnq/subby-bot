import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { config } from "@config";
import { newRequestId } from "@shared/ids";
import { logger } from "@shared/logger";
import {
  collectImageAttachments,
  describeAttachments,
  MAX_IMAGES_PER_REQUEST,
} from "@shared/media";
import { runAgent } from "../../agent/graph";
import { writeAudit } from "../../database/audit";
import { checkBudget } from "../../agent/usage";
import { startTypingLoop, stopTypingLoop } from "../typing";
import {
  getGuildSettings,
  hasAllowedRole,
  isAiChannelAllowed,
  isUserWithinRateLimit,
  memberRoleIds,
} from "../permissions/guard";
import { approvalComponents, previewEmbed } from "../components/approval-buttons";
import { feedbackRow } from "../components/feedback-buttons";
import { setPreviewMessageId } from "../../approvals/service";
import { storeResponseSnapshot } from "../../feedback/service";
import { checkCodeAccessSafety, codeAccessSafeReply } from "../../code-access/safety";

export const aiCommand = new SlashCommandBuilder()
  .setName("ai")
  .setDescription("Trò chuyện hoặc ra lệnh cho trợ lý AI quản lý server")
  .addStringOption((o) =>
    o
      .setName("prompt")
      .setDescription("Ví dụ: tạo category Học tập với 2 channel #thao-luan và #tai-lieu")
      .setRequired(true),
  )
  .addAttachmentOption((o) =>
    o.setName("file").setDescription("Đính kèm ảnh để mình phân tích (tối đa 3 ảnh nếu gửi qua mention)"),
  );

export async function handleAskInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild() || !interaction.channel) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!config.AI_ASSISTANT_ENABLED) {
    await interaction.reply({ content: "🔧 Trợ lý AI đang tạm chưa triển khai. Quay lại sau nhé.", flags: MessageFlags.Ephemeral });
    return;
  }

  const prompt = interaction.options.getString("prompt", true);
  if (checkCodeAccessSafety(prompt).blocked) {
    await interaction.reply({ ...codeAccessSafeReply(), flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = await getGuildSettings(interaction.guildId);

  if (!settings.enabled) {
    await interaction.reply({ content: "🔕 AI đã bị tắt trên server này.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!(await isAiChannelAllowed(settings, interaction.guildId, interaction.channelId))) {
    await interaction.reply({
      content:
        "📍 Channel này chưa được bật AI. Moderator dùng `/ai-config channel add` để thêm channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await hasAllowedRole(interaction.guildId, memberRoleIds(interaction.member)))) {
    await interaction.reply({
      content: "⛔ Bạn không có role được phép dùng bot.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await isUserWithinRateLimit(interaction.user.id))) {
    await interaction.reply({
      content: "⏳ Bạn đang gửi quá nhanh, thử lại sau ít phút nhé.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const budget = await checkBudget(interaction.guildId);
  if (!budget.ok) {
    await interaction.editReply({ content: `💰 ${budget.reason}\nHạn mức sẽ reset vào ngày mai (UTC).` });
    return;
  }

  const requestId = newRequestId();

  const attachment = interaction.options.getAttachment("file");
  const allAttachments = attachment
    ? [{ url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size }]
    : [];
  const { images } = collectImageAttachments(allAttachments);
  const imageUrls = images.map((i) => i.url);
  const attachmentNote = describeAttachments(allAttachments);

  const typingTimer = interaction.channel && !interaction.channel.isDMBased()
    ? startTypingLoop(interaction.channel)
    : null;

  const startedAt = Date.now();
  logger.info(
    { requestId, guildId: interaction.guildId, userId: interaction.user.id, prompt: prompt.slice(0, 200) },
    "agent request start (slash)",
  );

  let state;
  try {
    state = await runAgent({
      requestId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      memberRoleIds: memberRoleIds(interaction.member),
      input: prompt,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      attachmentNote: attachmentNote || undefined,
    });
  } catch (err) {
    logger.error({ err, requestId, elapsedMs: Date.now() - startedAt }, "agent run failed (slash)");
    await interaction.editReply({
      content: "⚠️ Oops, mình gặp sự cố khi xử lý yêu cầu này. Bạn thử lại giúp mình nhé. Nếu vẫn lỗi, nhờ moderator kiểm tra log.",
    });
    return;
  } finally {
    stopTypingLoop(typingTimer);
  }

  if (state.awaitingApproval && state.preview) {
    const previewMsg = await interaction.channel.send({
      embeds: [previewEmbed(state)],
      components: [approvalComponents(requestId, state.preview.risk)],
      allowedMentions: { parse: [] },
    });
    await setPreviewMessageId(requestId, previewMsg.id);
    await interaction.editReply({
      content: "🟡 Yêu cầu của bạn cần **xác nhận** trước khi thực hiện. Xem preview phía dưới ⬇️",
    });
    return;
  }

  const response = state.finalResponse ?? "Đã xử lý xong.";
  await storeResponseSnapshot(state);
  await interaction.editReply({
    content: response.slice(0, 2000),
    components: [feedbackRow(requestId)],
  });

  logger.info(
    { requestId, intent: state.intent, elapsedMs: Date.now() - startedAt },
    "agent request done (slash)",
  );

  await writeAudit({
    requestId,
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    action: "ai.responded",
    details: { intent: state.intent, risk: state.riskLevel },
  });
}
