import { MessageFlags, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import { isImageAttachment } from "@shared/media";
import { CODE_ACCESS_ACCOUNT_NOT_FOUND } from "../../../code-access/accounts";

export function isSafeImage(att: Attachment): boolean {
  return isImageAttachment({
    url: att.url,
    name: att.name,
    contentType: att.contentType,
    size: att.size,
  }) && att.size <= 5 * 1024 * 1024;
}

export function formatDate(value: Date | null | undefined): string {
  if (!value) return "chưa xác định";
  return value.toISOString().slice(0, 10);
}

export function maskDeviceLabel(label: string | null | undefined): string {
  if (!label) return "chưa lưu";
  return label.replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function replyAccountNotFound(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  await interaction.reply({
    content: CODE_ACCESS_ACCOUNT_NOT_FOUND,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export function truncateDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
