import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const aiConfigCommand = new SlashCommandBuilder()
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
          .setDescription("Hành động")
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
      .setDescription("Giới hạn role được dùng bot (bỏ hết = ai cũng dùng được)")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("Hành động")
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
          .setRequired(true)
          .addChoices(
            { name: "enabled", value: "enabled" },
            { name: "all_channels", value: "allChannels" },
            { name: "destructive_enabled", value: "destructiveEnabled" },
            { name: "allow_mentions", value: "allowMentions" },
          ),
      )
      .addBooleanOption((o) => o.setName("value").setRequired(true)),
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
