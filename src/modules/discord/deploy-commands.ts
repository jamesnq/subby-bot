import { REST, Routes, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import "dotenv/config";
import { config } from "@config";
import { logger } from "@shared/logger";
import { codeAccessCommand, codeAdminCommand } from "./commands/code-access";

function buildCommands() {
  const ai = new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Trò chuyện hoặc ra lệnh cho trợ lý AI quản lý server")
    .addStringOption((o) =>
      o
        .setName("prompt")
        .setDescription("Ví dụ: tạo category Học tập với 2 channel #thao-luan và #tai-lieu")
        .setRequired(true),
    )
    .addAttachmentOption((o) =>
      o.setName("file").setDescription("Đính kèm ảnh để mình phân tích"),
    );

  const aiConfig = new SlashCommandBuilder()
    .setName("ai-config")
    .setDescription("Cấu hình AI bot (chỉ dành cho ADMIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Bật/tắt AI trong channel")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Thao tác")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" },
            ),
        )
        .addChannelOption((o) => o.setName("target").setDescription("Channel")),
    )
    .addSubcommand((s) =>
      s
        .setName("role")
        .setDescription("Giới hạn role được dùng bot")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Thao tác")
            .setRequired(true)
            .addChoices(
              { name: "add", value: "add" },
              { name: "remove", value: "remove" },
              { name: "list", value: "list" },
            ),
        )
        .addRoleOption((o) => o.setName("target").setDescription("Role")),
    )
    .addSubcommand((s) =>
      s
        .setName("setting")
        .setDescription("Bật/tắt tính năng server-wide")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription("Tên setting")
            .setRequired(true)
            .addChoices(
              { name: "enabled", value: "enabled" },
              { name: "all_channels", value: "allChannels" },
              { name: "destructive_enabled", value: "destructiveEnabled" },
              { name: "allow_mentions", value: "allowMentions" },
            ),
        )
        .addBooleanOption((o) => o.setName("value").setDescription("Giá trị bật/tắt").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("support")
        .setDescription(
          "Cấu hình hỗ trợ: role mod (được ping khi escalate), mod-log channel, category cho ticket",
        )
        .addRoleOption((o) => o.setName("mod_role").setDescription("Role moderator"))
        .addChannelOption((o) =>
          o
            .setName("log_channel")
            .setDescription("Channel nhận escalation")
            .addChannelTypes(0),
        )
        .addChannelOption((o) =>
          o
            .setName("ticket_category")
            .setDescription("Category chứa ticket")
          .addChannelTypes(4),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("feedback")
        .setDescription("Xem hàng chờ feedback và báo cáo cải thiện")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("Hành động")
            .setRequired(true)
            .addChoices(
              { name: "pending", value: "pending" },
              { name: "report", value: "report" },
              { name: "mark_reviewed", value: "mark_reviewed" },
            ),
        )
        .addStringOption((o) =>
          o.setName("request_id").setDescription("Request id cần đánh dấu đã review"),
        )
        .addIntegerOption((o) =>
          o.setName("limit").setDescription("Số feedback hiển thị").setMinValue(1).setMaxValue(10),
        ),
    );

  const help = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Hướng dẫn sử dụng trợ lý AI");

  return [ai.toJSON(), aiConfig.toJSON(), help.toJSON(), codeAccessCommand.toJSON(), codeAdminCommand.toJSON()];
}

async function main() {
  const rest = new REST().setToken(config.DISCORD_TOKEN);
  const body = buildCommands();

  if (config.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: [] });
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body },
    );
    logger.info(
      `Registered ${body.length} guild commands in ${config.DISCORD_GUILD_ID} (global commands cleared)`,
    );
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body });
    logger.info(`Registered ${body.length} global commands`);
  }
}

main().catch((err) => {
  logger.error(err, "failed to register commands");
  process.exit(1);
});

