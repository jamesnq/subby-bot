import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  type ButtonInteraction,
} from "discord.js";
import { config } from "@config";
import { decideApproval, getApprovalRequest, verifyPlanIntegrity } from "../../approvals/service";
import { buildExecutionContext } from "../../agent/context-builder";
import { executePlan } from "../../agent/executor";
import { writeAudit } from "../../database/audit";
import { ADMIN_DENY_MESSAGE, getGuildSettings, isAdminMember } from "../permissions/guard";
import { getDiscordClient } from "@infra/discord/client";
import type { AgentState } from "../../agent/state";

export const APPROVE_PREFIX = "aiapprove:";
export const CANCEL_PREFIX = "aicancel:";

export function approvalComponents(requestId: string, risk: string = "write"): ActionRowBuilder<ButtonBuilder> {
  const isDestructive = risk === "destructive";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${requestId}`)
      .setLabel(isDestructive ? "⚠️ Xác nhận vĩnh viễn" : "✅ Xác nhận")
      .setStyle(isDestructive ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CANCEL_PREFIX}${requestId}`)
      .setLabel("Hủy")
      .setStyle(ButtonStyle.Secondary),
  );
}

export function previewEmbed(state: AgentState): EmbedBuilder {
  const risk = state.preview?.risk ?? "write";
  const embed = new EmbedBuilder()
    .setTitle(`${state.preview?.title ?? "🟡 GHI DỮ LIỆU"}: Kế hoạch cần xác nhận`)
    .setDescription(state.preview?.lines.join("\n").slice(0, 3900) || "Không có chi tiết")
    .setColor(risk === "destructive" ? 0xed4245 : 0xfee75c)
    .addFields(
      { name: "Người yêu cầu", value: `<@${state.userId}>`, inline: true },
      { name: "Mức độ", value: risk === "destructive" ? "🔴 PHÁ HỦY (không thể hoàn tác)" : "🟡 Ghi dữ liệu", inline: true },
      { name: "Hết hạn", value: `<t:${Math.floor(Date.now() / 1000) + config.APPROVAL_TTL_SECONDS}:R>`, inline: true },
    );
  if (risk === "destructive") {
    embed.addFields({
      name: "Lưu ý quan trọng",
      value: "Kế hoạch này chỉ được ADMIN (quyền Administrator) xác nhận, người yêu cầu không thể tự duyệt.",
    });
  }
  embed.setFooter({ text: `request: ${state.requestId.slice(0, 8)}…` });
  return embed;
}

function processedRows(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ai_processed")
      .setLabel("Đã xử lý")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export async function handleApprovalButton(interaction: ButtonInteraction): Promise<void> {
  const isApprove = interaction.customId.startsWith(APPROVE_PREFIX);
  const requestId = interaction.customId.slice(
    (isApprove ? APPROVE_PREFIX : CANCEL_PREFIX).length,
  );

  await interaction.deferUpdate();

  const record = await getApprovalRequest(requestId);
  if (!record) {
    await interaction.message.reply("⚠️ Không tìm thấy yêu cầu phê duyệt này.");
    return;
  }
  if (interaction.guildId && interaction.guildId !== record.guildId) {
    return;
  }

  if (record.status !== "pending") {
    await interaction.message.edit({ components: [processedRows()] });
    return;
  }

  const isModerator = interaction.inCachedGuild() && isAdminMember(interaction.member);
  const isRequester = interaction.user.id === record.requesterId;
  const allowed =
    record.risk === "destructive"
      ? Boolean(isModerator)
      : isRequester || Boolean(isModerator);

  if (!allowed) {
    await interaction.message.reply({
      content:
        record.risk === "destructive"
          ? "⛔ Hành động **phá hủy** chỉ ADMIN (quyền Administrator hoặc ADMIN chỉ định) mới xác nhận được."
          : "⛔ Chỉ người yêu cầu hoặc ADMIN mới có thể xử lý kế hoạch này.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (isApprove && !verifyPlanIntegrity(record)) {
    await interaction.message.edit({ components: [processedRows()] });
    await interaction.message.reply("🔒 Plan hash không khớp, từ chối thực thi vì lý do an toàn.");
    await writeAudit({
      requestId,
      guildId: record.guildId,
      actorId: interaction.user.id,
      action: "approval.hash_mismatch",
      status: "failed",
    });
    return;
  }

  const decided = await decideApproval(
    requestId,
    isApprove ? "approved" : "rejected",
    interaction.user.id,
  );
  if (!decided) {
    await interaction.message.edit({ components: [processedRows()] });
    await interaction.message.reply("⏰ Yêu cầu đã hết hạn hoặc đã được xử lý từ trước.");
    return;
  }

  await writeAudit({
    requestId,
    guildId: record.guildId,
    actorId: interaction.user.id,
    action: isApprove ? "approval.approved" : "approval.rejected",
  });

  await interaction.message.edit({ components: [processedRows()] });

  if (!isApprove) {
    const chan = interaction.channel;
    if (chan && !chan.isDMBased() && "send" in chan) {
      await chan.send({
        content: `🚫 Đã hủy kế hoạch (\`${requestId.slice(0, 8)}\`).`,
        allowedMentions: { parse: [] },
      });
    }
    return;
  }

  const chanForProgress = interaction.channel;
  const progressMsg =
    chanForProgress && !chanForProgress.isDMBased() && "send" in chanForProgress
      ? await chanForProgress
          .send({
            content: "⚙️ Đang thực hiện kế hoạch đã duyệt… vui lòng đợi chút nhé!",
            allowedMentions: { parse: [] },
          })
          .catch(() => null)
      : null;

  try {
    const client = getDiscordClient();
    const guild = await client.guilds.fetch(record.guildId);
    const member = await guild.members.fetch(record.requesterId);
    const fetched = await client.channels.fetch(record.channelId);
    if (
      !fetched ||
      fetched.isDMBased() ||
      (fetched.type !== ChannelType.GuildText && fetched.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("Channel không hợp lệ để gửi kết quả");
    }
    const channel = fetched as TextChannel;

    const ec = {
      requestId,
      guild,
      member,
      channel,
      settings: await getGuildSettings(record.guildId),
      allowMentions: member.permissions.has(PermissionFlagsBits.MentionEveryone),
    };

    const result = await executePlan(ec, record.planJson);

    const lines = result.outcomes.map((o) =>
      o.status === "success" || o.status === "skipped_idempotent"
        ? `✅ ${o.summary}`
        : o.status === "denied"
          ? `⛔ \`${o.toolName}\`: ${o.error}`
          : `❌ \`${o.toolName}\`: ${o.error}`,
    );
    if (result.compensated.length > 0) {
      lines.push(`↩️ Đã rollback: ${result.compensated.join(", ")}`);
    }
    await channel.send({ content: lines.join("\n").slice(0, 2000), allowedMentions: { parse: [] } });
    await progressMsg?.delete().catch(() => undefined);
  } catch (err) {
    await progressMsg?.delete().catch(() => undefined);
    const chan = interaction.channel;
    if (chan && !chan.isDMBased() && "send" in chan) {
      await chan.send({
        content: "❌ Thực thi thất bại, đã ghi nhận sự cố. Bạn thử lại sau hoặc nhờ moderator kiểm tra log nhé.".slice(0, 2000),
        allowedMentions: { parse: [] },
      });
    }
  }
}

