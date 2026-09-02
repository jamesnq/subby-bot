import {
  MessageFlags,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ButtonInteraction,
  type EmbedBuilder,
  type Message,
  type RepliableInteraction,
  type StringSelectMenuBuilder,
  type TextBasedChannel,
} from "discord.js";
import { config } from "@config";
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

/**
 * Waits on `channel` for up to CODE_ACCESS_THREAD_TTL_MINUTES for `count`
 * safe image attachments from `userId`. Takes a plain channel (not an
 * interaction) so it can run both from a fresh thread — before any button
 * exists to derive `interaction.channel` from — and, via callers that pass
 * `interaction.channel`, from a button click inside that same thread.
 */
export async function collectImageMessages(
  channel: TextBasedChannel,
  userId: string,
  count: number,
): Promise<Array<{ url: string; contentType: string | null; size: number; name: string }>> {
  if (!("createMessageCollector" in channel)) throw new Error("Channel không hỗ trợ nhận ảnh");
  return new Promise((resolve, reject) => {
    const images: Array<{ url: string; contentType: string | null; size: number; name: string }> = [];
    const collector = channel.createMessageCollector({
      filter: (message: Message) => message.author.id === userId,
      max: Math.max(count, 2),
      time: config.CODE_ACCESS_THREAD_TTL_MINUTES * 60_000,
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
      else reject(new Error(`Hết ${config.CODE_ACCESS_THREAD_TTL_MINUTES} phút mà chưa nhận đủ ảnh hợp lệ.`));
    });
  });
}

export type EditablePayload = {
  content?: string | null;
  embeds?: EmbedBuilder[];
  components?: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
};

export type EditableReply = { edit(payload: EditablePayload): Promise<unknown> };

/**
 * Unifies "edit the confirmation message" across the two ways that message
 * came to exist: a button click on it (RepliableInteraction.editReply, after
 * deferUpdate) or a plain message the bot sent into a thread directly
 * (Message.edit) — the very first status message of a signup thread has no
 * button interaction behind it yet.
 */
export function replyTarget(source: RepliableInteraction | Message): EditableReply {
  if ("editReply" in source) return { edit: (payload) => source.editReply(payload) };
  return { edit: (payload) => source.edit(payload) };
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
