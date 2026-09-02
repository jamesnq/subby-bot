import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { config } from "@config";
import { isAllowedCodeAccessAccount, normalizeSteamUsername } from "../../../code-access/accounts";
import { upsertCodeAccessDraft, updateCodeAccessDraft } from "../../../code-access/drafts";
import { getOpenEscalation } from "../../../code-access/escalations";
import { isSubscriptionActive, listUserSlots } from "../../../code-access/service";
import { getActivePenalty } from "../../../code-access/feedback-penalty";
import { replyAccountNotFound } from "./format";
import { GUIDE_IMAGES, mandatoryWarningEmbed, osUpgradedEmbed, requestDeviceRow, signupGuideEmbed, signupGuideRow, statusEmbed, supportButton, waitingEmbed } from "./components";
import { collectImageMessages, replyTarget } from "./interaction-utils";
import { runSignupEvidencePipeline } from "./signup-interactions";
import { closeCodeThread, resolveCodeAccessThread } from "./threads";

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
  // Chỉ signup/request bị khoá do thiếu feedback — /code status vẫn xem được bình thường.
  if (sub === "signup" || sub === "request") {
    const penalty = await getActivePenalty({ guildId: interaction.guildId, userId: interaction.user.id });
    if (penalty) {
      const daysLeft = Math.max(1, Math.ceil((penalty.bannedUntil.getTime() - Date.now()) / (24 * 60 * 60_000)));
      await interaction.reply({
        content: `⛔ Bạn chưa xác nhận feedback (👍/👎) cho lần dùng bot trước, nên \`/code signup\` và \`/code request\` đang bị tạm khoá.\nCòn lại: **${daysLeft} ngày**.\nBấm feedback ở tin nhắn cũ bất cứ lúc nào để gỡ khoá ngay, không cần đợi hết hạn.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
  }
  if (sub === "signup") await beginSignup(interaction);
  else if (sub === "request") await beginRequest(interaction);
  else if (sub === "status") await showStatus(interaction);
}

/**
 * Both signup and request now run inside a private thread (resolveCodeAccessThread):
 * only the invoking user + anyone with Manage Threads can see it, and every
 * step from here on is a plain thread message (never ephemeral) so it survives
 * into the transcript archived on close (see threads.ts).
 */
async function beginSignup(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const steamUsername = normalizeSteamUsername(interaction.options.getString("username", true));
  if (!steamUsername || !isAllowedCodeAccessAccount(steamUsername)) return replyAccountNotFound(interaction);

  const thread = await openThreadOrReplyError(interaction, "signup");
  if (!thread) return;

  const slots = await listUserSlots(interaction.guildId, interaction.user.id);
  const draft = await upsertCodeAccessDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    kind: "signup",
    step: "collecting",
    payload: { steamUsername, discordUsername: interaction.user.username, channelId: thread.id },
  });

  await thread.send({
    content: slots.length ? `👋 <@${interaction.user.id}> Bạn đang có ${slots.length} gói — đăng ký thêm 1 gói mới cho thiết bị này.` : `👋 <@${interaction.user.id}>`,
    embeds: [mandatoryWarningEmbed()],
    allowedMentions: { users: [interaction.user.id] },
  });

  await thread.send({ embeds: [signupGuideEmbed(config.CODE_ACCESS_THREAD_TTL_MINUTES)], components: [signupGuideRow()] });
  const status = await thread.send({ content: `⏳ Đang chờ 2 ảnh (bill + thông tin máy)… còn ${config.CODE_ACCESS_THREAD_TTL_MINUTES} phút.` });
  await updateCodeAccessDraft({ id: draft.id, userId: interaction.user.id, messageId: status.id });
  try {
    const [receivedPurchase, receivedDevice] = await collectImageMessages(thread, interaction.user.id, 2);
    await runSignupEvidencePipeline(replyTarget(status), draft, receivedPurchase, receivedDevice);
  } catch (error) {
    await status.edit({
      content: `⛔ ${error instanceof Error ? error.message : "Không nhận đủ ảnh"}\nChạy lại \`/code signup\` trong kênh này khi sẵn sàng, hoặc liên hệ fanpage.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(supportButton())],
    }).catch(() => undefined);
    await closeCodeThread({ thread, summary: "⏰ Hết thời gian chờ ảnh." });
  }
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

  const thread = await openThreadOrReplyError(interaction, "request");
  if (!thread) return;

  const draft = await upsertCodeAccessDraft({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    kind: "request",
    step: "choose_device",
    payload: { steamUsername, discordUsername: interaction.user.username, channelId: thread.id },
  });
  const embed = new EmbedBuilder().setTitle("Bạn đang dùng thiết bị gì?").setColor(0x5865f2).setDescription([
    "🖥️ **PC / Laptop**: gửi **1 ảnh toàn màn hình** thấy đồng thời Steam đang hỏi mã, Settings → System → About, và đồng hồ taskbar.",
    "🎮 **Handheld** (Steam Deck, ROG Ally…): gửi **2 ảnh riêng** — (1) màn hình Steam hỏi mã, (2) thông tin máy. Cả hai phải thấy rõ giờ/ngày.",
    "",
    "**Ảnh mẫu:**",
    `📱 Steam hỏi mã: ${GUIDE_IMAGES.steam}`,
    `💻 Settings → System → About: ${GUIDE_IMAGES.device}`,
    "",
    "Chọn loại thiết bị bên dưới.",
  ].join("\n"));
  const message = await thread.send({ content: `👋 <@${interaction.user.id}>`, embeds: [embed], components: [requestDeviceRow(draft.id)], allowedMentions: { users: [interaction.user.id] } });
  await updateCodeAccessDraft({ id: draft.id, userId: interaction.user.id, messageId: message.id });
}

async function showStatus(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const slots = await listUserSlots(interaction.guildId, interaction.user.id);
  await interaction.reply({ embeds: [statusEmbed(slots)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/**
 * Resolves/creates the private thread and acks the slash command with a
 * short ephemeral pointer (or nothing user-visible beyond "continuing here"
 * when the command was already run from inside a reusable code-access
 * thread). Returns undefined (after replying with the error) if a thread
 * genuinely can't be opened here.
 */
async function openThreadOrReplyError(interaction: ChatInputCommandInteraction<"cached">, label: "signup" | "request") {
  try {
    const { thread } = await resolveCodeAccessThread(interaction, label);
    await interaction.reply({
      content: thread.id === interaction.channelId ? "▶️ Tiếp tục trong kênh này." : `📩 Đã mở kênh riêng tư: <#${thread.id}>`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return thread;
  } catch (error) {
    await interaction.reply({
      content: `⛔ ${error instanceof Error ? error.message : "Không mở được kênh riêng tư"}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return undefined;
  }
}

