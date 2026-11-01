import {
  Events,
  type Client,
} from "discord.js";
import { codeCommand, handleCodeInteraction, handlePaymentButton } from "../commands/code";
import { codeAdminCommand, codeWhitelistCommand, handleCodeAdminInteraction } from "../commands/code-admin";
import { logger } from "@shared/logger";

export function registerInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId.startsWith("payment:check:")) {
        await handlePaymentButton(interaction);
        return;
      }
      if (interaction.isChatInputCommand()) {
        if ([codeAdminCommand.name, codeWhitelistCommand.name].includes(interaction.commandName)) {
          await handleCodeAdminInteraction(interaction);
          return;
        }
        if (interaction.commandName === codeCommand.name) {
          await handleCodeInteraction(interaction);
        }
        return;
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
