import { MessageFlags, type ButtonInteraction, type Message, type RepliableInteraction } from "discord.js";
import { getCodeAccessDraft } from "../../../code-access/drafts";
import type { CodeAccessDraftKind, CodeAccessDraftRow } from "../../../database/schema";
import { isSafeImage } from "./format";

export type DraftInteraction = ButtonInteraction;

export async function ownedDraft(
  interaction: RepliableInteraction,
  id: string,
  kind: CodeAccessDraftKind,
): Promise<CodeAccessDraftRow | undefined> {
  const draft = await getCodeAccessDraft(id);
  if (!draft || draft.kind !== kind) {
    await safeEphemeralReply(interaction, "⏰ Phiên này đã hết hạn. Hãy chạy lại lệnh `/code`.");
    return undefined;
  }
  if (draft.userId !== interaction.user.id || (interaction.guildId && draft.guildId !== interaction.guildId)) {
    await safeEphemeralReply(interaction, "⛔ Chỉ người tạo yêu cầu mới dùng được nút này.");
    return undefined;
  }
  return draft;
}

export async function collectImageMessages(
  interaction: ButtonInteraction,
  count: number,
): Promise<Array<{ url: string; contentType: string | null; size: number; name: string }>> {
  const channel = interaction.channel;
  if (!channel || !("createMessageCollector" in channel)) throw new Error("Channel không hỗ trợ nhận ảnh");
  return new Promise((resolve, reject) => {
    const images: Array<{ url: string; contentType: string | null; size: number; name: string }> = [];
    const collector = channel.createMessageCollector({
      filter: (message: Message) => message.author.id === interaction.user.id,
      max: 2,
      time: 10 * 60_000,
    });
    collector.on("collect", (message: Message) => {
      for (const attachment of message.attachments.values()) {
        if (isSafeImage(attachment)) images.push({ url: attachment.url, contentType: attachment.contentType, size: attachment.size, name: attachment.name });
        if (images.length >= count) {
          collector.stop("complete");
          break;
        }
      }
    });
    collector.on("end", () => {
      if (images.length >= count) resolve(images.slice(0, count));
      else reject(new Error("Hết 10 phút mà chưa nhận đủ ảnh hợp lệ."));
    });
  });
}

export async function safeEphemeralReply(interaction: RepliableInteraction, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function asRemoteImage(value: unknown): { url: string; contentType?: string | null; size?: number } | null {
  const item = asObject(value);
  return typeof item.url === "string" ? { url: item.url, contentType: typeof item.contentType === "string" ? item.contentType : null, size: typeof item.size === "number" ? item.size : undefined } : null;
}
