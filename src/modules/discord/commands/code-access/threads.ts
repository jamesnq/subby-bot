import {
  AttachmentBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type Message,
  type PrivateThreadChannel,
  type PublicThreadChannel,
} from "discord.js";
import { config } from "@config";
import { getDiscordClient } from "@infra/discord/client";
import { logger } from "@shared/logger";
import { feedbackRow } from "../../components/feedback-buttons";

const THREAD_NAME_PREFIX = "code-";

// discord.js narrows `.isThread()` and `.threads.create()` to this union
// rather than a plain `ThreadChannel` — we always create PrivateThread, but
// the type system can't statically know that, so we accept both.
type CodeAccessThread = PublicThreadChannel<boolean> | PrivateThreadChannel;

/**
 * `/code signup` and `/code request` each run inside a bot-created private
 * thread: only the invoking user (added as a thread member) plus anyone with
 * Manage Threads (admins/mods — private threads are visible to them without
 * being added) can see it. Everything from the guide message to the OCR
 * confirmation to an admin escalation happens as ordinary thread messages,
 * never ephemeral replies — ephemeral messages aren't real channel messages,
 * so they would silently vanish from the transcript archived on close.
 */
export async function resolveCodeAccessThread(
  interaction: ChatInputCommandInteraction<"cached">,
  label: "signup" | "request",
): Promise<{ thread: CodeAccessThread; reused: boolean }> {
  const current = interaction.channel;
  if (current && (await isReusableCodeThread(current, interaction.user.id))) {
    return { thread: current as CodeAccessThread, reused: true };
  }

  const parent = current?.isThread() ? current.parent : current;
  if (!parent || parent.type !== ChannelType.GuildText) {
    throw new Error("Không thể mở kênh riêng tư ở đây. Hãy dùng lệnh trong 1 channel văn bản của server.");
  }
  const safeUser = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20) || "user";
  const thread = await parent.threads.create({
    name: `${THREAD_NAME_PREFIX}${safeUser}-${label}`.slice(0, 90),
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 60,
    reason: `code-access ${label} cho ${interaction.user.tag}`,
  });
  await thread.members.add(interaction.user.id).catch((err) => logger.warn({ err, threadId: thread.id }, "code-access: could not add user to thread"));
  return { thread, reused: false };
}

async function isReusableCodeThread(channel: NonNullable<ChatInputCommandInteraction<"cached">["channel"]>, userId: string): Promise<boolean> {
  if (!channel.isThread()) return false;
  const thread = channel as CodeAccessThread;
  if (thread.archived || thread.locked) return false;
  if (!thread.name.startsWith(THREAD_NAME_PREFIX)) return false;
  if (thread.ownerId !== thread.client.user?.id) return false;
  const member = await thread.members.fetch(userId).catch(() => null);
  return Boolean(member);
}

/** Adds an admin to the thread so an escalation ping can actually be opened, not just seen in mod-log. */
export async function addAdminToThread(thread: CodeAccessThread, adminId: string): Promise<void> {
  await thread.members.add(adminId).catch((err) => logger.warn({ err, threadId: thread.id, adminId }, "code-access: could not add admin to thread"));
}

/**
 * Terminal close for a code-access thread: optionally asks for feedback
 * (reused aifeedback:* buttons — already routed by interaction-create.ts),
 * archives the full message history to CODE_ACCESS_TRANSCRIPT_CHANNEL_ID as
 * a .txt file, then locks + archives the thread. Never throws — closing is
 * best-effort cleanup, not something a user-facing flow should fail on.
 */
export async function closeCodeThread(input: {
  thread: CodeAccessThread;
  summary: string;
  withFeedback?: boolean;
}): Promise<void> {
  const { thread } = input;
  try {
    if (input.withFeedback) {
      await thread.send({
        content: `${input.summary}\n\nCảm ơn bạn đã dùng dịch vụ! Bấm 👍/👎 bên dưới trong vòng **1 giờ** — bỏ qua bước này sẽ tạm khoá \`/code signup\` và \`/code request\` **7 ngày** (bấm feedback trễ vẫn gỡ khoá ngay).`,
        components: [feedbackRow(thread.id)],
      });
    } else {
      await thread.send({ content: input.summary });
    }
  } catch (err) {
    logger.warn({ err, threadId: thread.id }, "code-access: could not send closing message");
  }
  await archiveTranscript(thread).catch((err) => logger.warn({ err, threadId: thread.id }, "code-access: transcript archive failed"));
  await thread.setLocked(true).catch((err) => logger.warn({ err, threadId: thread.id }, "code-access: could not lock thread"));
  await thread.setArchived(true).catch((err) => logger.warn({ err, threadId: thread.id }, "code-access: could not archive thread"));
}

const MAX_TRANSCRIPT_PAGES = 10;

async function archiveTranscript(thread: CodeAccessThread): Promise<void> {
  const messages: Message[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_TRANSCRIPT_PAGES; page++) {
    const batch = await thread.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = messages.map((message) => {
    const time = new Date(message.createdTimestamp).toISOString().slice(0, 19).replace("T", " ");
    const author = `${message.author.tag}${message.author.bot ? " [bot]" : ""}`;
    const attachments = [...message.attachments.values()].map((a) => `\n    [attachment] ${a.name}: ${a.url}`).join("");
    const embeds = message.embeds.map((e) => `\n    [embed] ${e.title ?? ""} ${e.description ?? ""}`.trimEnd()).join("");
    const content = message.content || (message.embeds.length || message.attachments.size ? "" : "(trống)");
    return `[${time}] ${author}: ${content}${attachments}${embeds}`;
  });
  const body = lines.join("\n") || "(không có tin nhắn nào trong thread)";

  const client = getDiscordClient();
  const channel = await client.channels.fetch(config.CODE_ACCESS_TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (!channel || !("send" in channel)) {
    logger.warn({ threadId: thread.id, channelId: config.CODE_ACCESS_TRANSCRIPT_CHANNEL_ID }, "code-access: transcript channel unavailable");
    return;
  }
  const file = new AttachmentBuilder(Buffer.from(body, "utf-8"), { name: `code-access-${thread.id}.txt` });
  await channel.send({
    content: `📄 Transcript \`${thread.name}\` (${messages.length} tin nhắn) — <#${thread.id}>`,
    files: [file],
    allowedMentions: { parse: [] },
  });
}
