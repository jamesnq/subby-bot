import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { writeAudit } from "../../database/audit";
import {
  feedbackStats,
  listPendingBadFeedback,
  markFeedbackReviewed,
  renderFeedbackReport,
} from "../../feedback/service";
import {
  addAiChannel,
  addAllowedRole,
  listAllowedChannels,
  getGuildSettings,
  isAdminMember,
  ADMIN_DENY_MESSAGE,
  listAllowedRoleIds,
  removeAiChannel,
  removeAllowedRole,
  updateGuildSetting,
} from "../permissions/guard";

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

export async function handleAiConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: 64 });
    return;
  }
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({ content: ADMIN_DENY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guildId;

  if (sub === "channel") {
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const ids = await listAllowedChannels(guildId);
      await interaction.reply({
        content: ids.length ? `Các channel bật AI:\n${ids.map((id) => `<#${id}>`).join("\n")}` : "Chưa có channel nào được bật.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    const target = interaction.options.getChannel("target");
    if (!target) {
      await interaction.reply({ content: "Cần chỉ định channel.", flags: 64 });
      return;
    }
    if (action === "add") {
      await addAiChannel(guildId, target.id, interaction.user.id);
      await interaction.reply({ content: `✅ Đã bật AI trong <#${target.id}>`, allowedMentions: { parse: [] } });
    } else {
      await removeAiChannel(guildId, target.id);
      await interaction.reply({ content: `✅ Đã tắt AI trong <#${target.id}>`, allowedMentions: { parse: [] } });
    }
    await writeAudit({
      guildId,
      actorId: interaction.user.id,
      action: `config.channel.${action}`,
      targetType: "channel",
      targetId: target.id,
    });
    return;
  }

  if (sub === "role") {
    const action = interaction.options.getString("action", true);
    if (action === "list") {
      const rows = await listAllowedRoleIds(guildId);
      await interaction.reply({
        content: rows.length ? `Các role được dùng bot:\n${rows.map((r) => `<@&${r}>`).join("\n")}` : "Mọi người đều dùng được bot (chưa giới hạn role).",
        allowedMentions: { parse: [] },
      });
      return;
    }
    const role = interaction.options.getRole("target");
    if (!role) {
      await interaction.reply({ content: "Cần chỉ định role.", flags: 64 });
      return;
    }
    if (action === "add") {
      await addAllowedRole(guildId, role.id, interaction.user.id);
      await interaction.reply({ content: `✅ Đã cho phép <@&${role.id}> dùng bot`, allowedMentions: { parse: [] } });
    } else {
      await removeAllowedRole(guildId, role.id);
      await interaction.reply({ content: `✅ Đã gỡ <@&${role.id}> khỏi danh sách`, allowedMentions: { parse: [] } });
    }
    await writeAudit({
      guildId,
      actorId: interaction.user.id,
      action: `config.role.${action}`,
      targetType: "role",
      targetId: role.id,
    });
    return;
  }

  if (sub === "support") {
    const modRole = interaction.options.getRole("mod_role");
    const logChannel = interaction.options.getChannel("log_channel");
    const ticketCategory = interaction.options.getChannel("ticket_category");

    if (!modRole && !logChannel && !ticketCategory) {
      await interaction.reply({
        content: "Cần cung cấp ít nhất một trong: mod_role, log_channel, ticket_category.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await getGuildSettings(guildId);
    if (modRole) {
      await updateGuildSetting(guildId, "modRoleId", modRole.id);
    }
    if (logChannel) {
      await updateGuildSetting(guildId, "modLogChannelId", logChannel.id);
    }
    if (ticketCategory) {
      await updateGuildSetting(guildId, "supportCategoryId", ticketCategory.id);
    }

    const lines = [
      modRole ? `Mod role: <@&${modRole.id}>` : null,
      logChannel ? `Log channel: <#${logChannel.id}>` : null,
      ticketCategory ? `Ticket category: ${ticketCategory.name}` : null,
    ].filter(Boolean);
    await interaction.reply({
      content: `✅ Đã lưu:\n${lines.join("\n")}`,
      allowedMentions: { parse: [] },
    });
    await writeAudit({
      guildId,
      actorId: interaction.user.id,
      action: "config.support",
      details: { modRoleId: modRole?.id, modLogChannelId: logChannel?.id, supportCategoryId: ticketCategory?.id },
    });
    return;
  }

  if (sub === "feedback") {
    const action = interaction.options.getString("action", true);
    const limit = interaction.options.getInteger("limit") ?? 5;

    if (action === "pending") {
      const rows = await listPendingBadFeedback(guildId, limit);
      await interaction.reply({
        content: renderFeedbackReport(rows),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "report") {
      const rows = await listPendingBadFeedback(guildId, Math.min(limit, 5));
      await interaction.reply({
        content: [`📈 Feedback report`, "", await feedbackStats(guildId), "", renderFeedbackReport(rows)].join("\n"),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === "mark_reviewed") {
      const requestId = interaction.options.getString("request_id");
      if (!requestId) {
        await interaction.reply({
          content: "Cần nhập `request_id` để đánh dấu đã review.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const count = await markFeedbackReviewed(guildId, requestId, interaction.user.id);
      await interaction.reply({
        content: count > 0
          ? `✅ Đã đánh dấu reviewed cho \`${requestId}\` (${count} feedback).`
          : `Không tìm thấy feedback xấu cho request \`${requestId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (sub === "setting") {
    const key = interaction.options.getString("key", true) as
      | "enabled"
      | "allChannels"
      | "destructiveEnabled"
      | "allowMentions";
    const value = interaction.options.getBoolean("value", true);
    await updateGuildSetting(guildId, key, value);
    await interaction.reply(`✅ \`${key}\` = ${value}`);
    await writeAudit({
      guildId,
      actorId: interaction.user.id,
      action: `config.setting.${key}`,
      details: { value },
    });
  }
}




