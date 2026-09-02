import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { config } from "@config";
import { adminGrantSlot, adminRebindSlot, adminRevokeSlot, getCodeAccessStats } from "../../../code-access/admin";
import { allowedCodeAccessAccountDisplay, allowedCodeAccessAccounts } from "../../../code-access/accounts";
import { listOpenEscalations } from "../../../code-access/escalations";
import { findLatestSteamCodesForAccountsWithCache, findLatestSteamCodeWithCache } from "../../../code-access/steam-code-cache";
import { GmailSteamMailError, formatSteamCodeLine } from "../../../gmail/steam-mail";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../../permissions/guard";
import { replyAccountNotFound, truncateDiscord } from "./format";

export async function handleCodeAdminInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({ content: ADMIN_DENY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (sub === "code") await handleCode(interaction);
    else if (sub === "grant") await handleGrant(interaction);
    else if (sub === "rebind") await handleRebind(interaction);
    else if (sub === "revoke") await handleRevoke(interaction);
    else if (sub === "queue") await handleQueue(interaction);
    else if (sub === "stats") await handleStats(interaction);
  } catch (error) {
    await interaction.editReply({ content: `⛔ ${formatAdminError(error)}`, allowedMentions: { parse: [] } });
  }
}

async function handleCode(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!config.GMAIL_ENABLED) throw new Error("Gmail đang tắt; cấu hình OAuth readonly trước.");
  const username = interaction.options.getString("username") ?? undefined;
  const account = username ? allowedCodeAccessAccountDisplay(username) : undefined;
  if (username && !account) {
    await interaction.editReply({ content: "Account does not exist." });
    return;
  }
  const content = account ? await findOneAdminCode(account) : await findAllAdminCodes();
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

async function handleGrant(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const slot = await adminGrantSlot({
    guildId: interaction.guildId, userId: user.id, discordUsername: user.username,
    steamUsername: interaction.options.getString("username", true),
    planKind: interaction.options.getString("plan", true) as "month" | "year" | "lifetime",
    deviceId: interaction.options.getString("device_id", true), adminId: interaction.user.id,
  });
  await interaction.editReply({ content: `✅ Đã cấp slot \`${slot.id}\` cho <@${user.id}> (${slot.steamUsername}).` });
}

async function handleRebind(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const slotId = interaction.options.getString("slot", true);
  if (!isUuid(slotId)) throw new Error("Slot ID không hợp lệ.");
  const row = await adminRebindSlot({ guildId: interaction.guildId, userId: user.id, slotId, adminId: interaction.user.id });
  await interaction.editReply({ content: row ? `✅ <@${user.id}> có thể chạy \`/code signup\` để gắn lại máy cho slot này.` : "Không tìm thấy slot thuộc user." });
}

async function handleRevoke(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const slotId = interaction.options.getString("slot", true);
  if (!isUuid(slotId)) throw new Error("Slot ID không hợp lệ.");
  const row = await adminRevokeSlot({ guildId: interaction.guildId, userId: user.id, slotId, adminId: interaction.user.id });
  await interaction.editReply({ content: row ? `✅ Đã thu hồi slot \`${row.id}\`.` : "Không tìm thấy slot thuộc user." });
}

async function handleQueue(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const rows = await listOpenEscalations(interaction.guildId, 10);
  const content = rows.length ? rows.map((row) => `• \`${row.id}\` · ${row.kind} · <@${row.userId}> · <t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`).join("\n") : "Không có escalation đang chờ.";
  await interaction.editReply({ content });
}

async function handleStats(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const stats = await getCodeAccessStats(interaction.guildId);
  const checked = stats.issuedCodes + stats.osMismatches;
  const mismatchRate = checked ? `${Math.round(stats.osMismatches / checked * 100)}%` : "—";
  await interaction.editReply({ content: [
    `Tổng slot: **${stats.totalSlots}**`, `Mã đã phát: **${stats.issuedCodes}**`,
    `OS mismatch: **${stats.osMismatches}** (${mismatchRate} lượt đã kiểm tra)`,
    `Escalation đang mở: **${stats.openEscalations}** · low-confidence tích lũy: **${stats.lowConfidenceEscalations}**`,
    `Confidence signup trung bình: **${stats.averageConfidence == null ? "—" : `${Math.round(stats.averageConfidence * 100)}%`}**`,
    `Policy hiện tại: \`${config.CODE_ACCESS_OS_POLICY}\``,
  ].join("\n") });
}

async function findOneAdminCode(account: string): Promise<string> {
  const result = await findLatestSteamCodeWithCache(account);
  return result ? formatAccountCodeResult(result) : `Không tìm thấy mã Steam mới nhất cho \`${account}\`.`;
}

async function findAllAdminCodes(): Promise<string> {
  const { results, errors } = await findLatestSteamCodesForAccountsWithCache(allowedCodeAccessAccounts());
  if (!results.length) return `Không tìm thấy mã Steam nào.${errors[0] ? ` Gmail lỗi: ${errors[0]}` : ""}`;
  return truncateDiscord(results.map(formatAccountCodeResult).join("\n"), 1_900);
}

function formatAccountCodeResult(result: NonNullable<Awaited<ReturnType<typeof findLatestSteamCodeWithCache>>>): string {
  const line = formatSteamCodeLine({ ...result.entry, account: result.account });
  return result.source === "gmail" ? line : `${line}\nNguồn: cache (${result.entry.receivedAt ?? "không rõ thời gian"}).`;
}

function formatAdminError(error: unknown): string {
  if (error instanceof GmailSteamMailError) return error.message;
  return error instanceof Error ? error.message : "Không xử lý được yêu cầu.";
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
