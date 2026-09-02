import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { config } from "@config";
import { ADMIN_DENY_MESSAGE, isAdminMember } from "../../permissions/guard";
import {
  allowedCodeAccessAccountDisplay,
  allowedCodeAccessAccounts,
} from "../../../code-access/accounts";
import {
  findLatestSteamCodesForAccountsWithCache,
  findLatestSteamCodeWithCache,
} from "../../../code-access/steam-code-cache";
import { GmailSteamMailError, formatSteamCodeLine } from "../../../gmail/steam-mail";
import { replyAccountNotFound, truncateDiscord } from "./format";

export async function handleCodeAdminInteraction(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "Lệnh này chỉ dùng trong server.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!isAdminMember(interaction.member)) {
    await interaction.reply({ content: ADMIN_DENY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!config.GMAIL_ENABLED) {
    await interaction.reply({
      content: "Gmail đang tắt. Bật `GMAIL_ENABLED=true` và cấu hình OAuth Gmail readonly trong `.env`.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const username = interaction.options.getString("username") ?? undefined;
  const account = username ? allowedCodeAccessAccountDisplay(username) : undefined;
  if (username && !account) {
    await replyAccountNotFound(interaction);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const content = account
      ? await findOneAdminCode(account)
      : await findAllAdminCodes();

    await interaction.editReply({
      content,
      allowedMentions: { parse: [] },
    });
  } catch (error: unknown) {
    await interaction.editReply({
      content: `⛔ ${formatAdminCodeError(error)}`,
      allowedMentions: { parse: [] },
    });
  }
}

async function findOneAdminCode(account: string): Promise<string> {
  const result = await findLatestSteamCodeWithCache(account);
  return result
    ? formatAccountCodeResult(result)
    : `Không tìm thấy mã Steam mới nhất cho \`${account}\` trong Gmail hoặc cache.`;
}

async function findAllAdminCodes(): Promise<string> {
  const { results, errors } = await findLatestSteamCodesForAccountsWithCache(allowedCodeAccessAccounts());
  if (results.length === 0) {
    const detail = errors[0] ? ` Gmail lỗi: ${errors[0]}` : "";
    return `Không tìm thấy mã Steam nào trong Gmail hoặc cache.${detail}`;
  }

  return truncateDiscord(results.map(formatAccountCodeResult).join("\n"), 1_900);
}

function formatAccountCodeResult(
  result: Awaited<ReturnType<typeof findLatestSteamCodeWithCache>>,
): string {
  if (!result) {
    return "Không tìm thấy mã Steam mới nhất trong Gmail hoặc cache.";
  }

  const line = formatSteamCodeLine({ ...result.entry, account: result.account });
  if (result.source === "gmail") return line;

  const receivedAt = result.entry.receivedAt
    ? new Date(result.entry.receivedAt).toISOString()
    : "không rõ thời gian";
  const warning = result.gmailError
    ? `Gmail lỗi: ${result.gmailError}`
    : "Dùng cache mới nhất.";

  return truncateDiscord(`${line}\nNguồn: cache (${receivedAt}). ${warning}`, 1_900);
}

function formatAdminCodeError(error: unknown): string {
  if (error instanceof Error && error instanceof GmailSteamMailError) {
    return error.message;
  }
  return "Không đọc được Gmail lúc này.";
}
