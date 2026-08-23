import {
  EmbedBuilder,
  Events,
  MessageFlags,
  type Client,
} from "discord.js";
import { handleAskInteraction } from "../commands/ai";
import { handleAiConfig } from "../commands/ai-config";
import {
  APPROVE_PREFIX,
  CANCEL_PREFIX,
  handleApprovalButton,
} from "../components/approval-buttons";
import { FEEDBACK_PREFIX, handleFeedbackButton } from "../components/feedback-buttons";
import { logger } from "../../observability/logger";

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "ai") {
          await handleAskInteraction(interaction);
        } else if (interaction.commandName === "ai-config") {
          await handleAiConfig(interaction);
        } else if (interaction.commandName === "help") {
          const embed = new EmbedBuilder()
            .setTitle("🤖 Trợ lý AI: Mình có thể giúp gì?")
            .setColor(0x5865f2)
            .addFields(
              {
                name: "🏗️ Quản lý server",
                value: 'Mention mình hoặc `/ai`: *"tạo category Học tập với 2 channel #thao-luan, #tai-lieu"*',
              },
              { name: "🖼️ Phân tích ảnh", value: "Gửi ảnh kèm mention, mình sẽ xem và nhận xét nội dung ảnh." },
              { name: "📚 Tra cứu tri thức server", value: '*"luật server là gì?"*, *"cách mua key như thế nào"*' },
              { name: "⏰ Lên lịch & nhắc", value: '*"lên lịch gửi recap sau 60 phút"*' },
              { name: "🎫 Hỗ trợ", value: '*"tạo ticket giúp mình về lỗi thanh toán"*, *"chuyển việc này cho moderator"*' },
              {
                name: "🛡️ An toàn",
                value:
                  "Mọi hành động ghi dữ liệu đều có **preview + nút xác nhận** trước khi chạy.\nHành động phá hủy (xóa channel/category) cần moderator duyệt.",
              },
            )
            .setFooter({ text: "Chi tiết cấu hình: /ai-config (yêu cầu Manage Server)" });
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        return;
      }

      if (interaction.isButton() && !interaction.customId.startsWith("ai_")) {
        if (
          interaction.customId.startsWith(APPROVE_PREFIX) ||
          interaction.customId.startsWith(CANCEL_PREFIX)
        ) {
          await handleApprovalButton(interaction);
        } else if (interaction.customId.startsWith(FEEDBACK_PREFIX)) {
          await handleFeedbackButton(interaction);
        }
      }
    } catch (err) {
      logger.error({ err }, "interaction handler error");
      const payload = { content: "⚠️ Đã xảy ra lỗi khi xử lý yêu cầu.", flags: 64 };
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction
            .followUp({ content: payload.content, flags: 64 })
            .catch(() => undefined);
        } else {
          await interaction.reply(payload).catch(() => undefined);
        }
      }
    }
  });
}
