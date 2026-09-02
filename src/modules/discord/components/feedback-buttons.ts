import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { recordFeedbackFromButton } from "../../feedback/service";
import { resolveFeedbackObligation } from "../../code-access/feedback-penalty";

export const FEEDBACK_PREFIX = "aifeedback:";

export function feedbackRow(requestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${FEEDBACK_PREFIX}up:${requestId}`)
      .setLabel("Hữu ích")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${FEEDBACK_PREFIX}down:${requestId}`)
      .setLabel("Chưa tốt")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function handleFeedbackButton(interaction: import("discord.js").ButtonInteraction): Promise<void> {
  const parts = interaction.customId.slice(FEEDBACK_PREFIX.length).split(":");
  const rating = parts[0] === "up" ? "up" : "down";
  const requestId = parts.slice(1).join(":");

  // Phản hồi interaction NGAY (deadline ~3s của Discord), việc nặng làm sau
  await interaction.update({ components: [] });

  const result = await recordFeedbackFromButton({
    requestId: requestId || "unknown",
    guildId: interaction.guildId ?? "dm",
    userId: interaction.user.id,
    rating,
  }).catch(() => ({ cacheInvalidated: false }));

  // No-op unless `requestId` is a thread awaiting code-access feedback — this
  // is the button used for the unrelated /ai answer-quality rating too.
  // Lets a late confirmation (even after the 7-day penalty already landed)
  // lift it right away instead of waiting for the next sweep.
  if (interaction.guildId && requestId) {
    await resolveFeedbackObligation({ guildId: interaction.guildId, userId: interaction.user.id, threadId: requestId }).catch(() => undefined);
  }

  await interaction.followUp({
    content:
      rating === "up"
        ? "Cảm ơn bạn! 🙏 Phản hồi giúp mình cải thiện mỗi ngày."
        : result.cacheInvalidated
          ? "Cảm ơn bạn đã báo 🙏 Mình đã ghi nhận và tạm bỏ cache của câu trả lời này để không lặp lại lỗi."
          : "Cảm ơn bạn đã phản hồi 🙏 Mình đã ghi nhận để admin xem lại câu trả lời này.",
    flags: 64,
  }).catch(() => undefined);
}
