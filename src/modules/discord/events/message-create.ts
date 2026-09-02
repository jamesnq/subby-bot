import { Events, type Client, type Message } from "discord.js";
import { runAgent } from "../../agent/graph";
import { config } from "@config";
import { writeAudit } from "../../database/audit";
import { newRequestId } from "@shared/ids";
import {
  collectImageAttachments,
  describeAttachments,
  MAX_IMAGES_PER_REQUEST,
} from "@shared/media";
import { logger } from "@shared/logger";
import {
  getGuildSettings,
  hasAllowedRole,
  isAiChannelAllowed,
  isUserWithinRateLimit,
  memberRoleIds,
} from "../permissions/guard";
import { approvalComponents, previewEmbed } from "../components/approval-buttons";
import { feedbackRow } from "../components/feedback-buttons";
import { startTypingLoop, stopTypingLoop } from "../typing";
import { setPreviewMessageId } from "../../approvals/service";
import { checkBudget } from "../../agent/usage";
import { storeResponseSnapshot } from "../../feedback/service";
import {
  scheduleConversationFollowUp,
  type SessionIdentity,
} from "../conversation-session";
import { discordConversationSessions } from "../session";
import {
  canAutoReplyInChannel,
  isBotLoopRiskMessage,
  sessionRateLimitKey,
} from "../session-safety";
import { checkCodeAccessSafety, codeAccessSafeReply } from "../../code-access/safety";

function mentionUser(userId: string, text: string): string {
  return `<@${userId}> ${text}`.slice(0, 2000);
}

export function registerMessageCreate(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    let lockedSessionId: string | undefined;
    try {
      if (!config.AI_ASSISTANT_ENABLED) return;
      if (isBotLoopRiskMessage(message, client.user?.id)) return;
      if (!message.guild || !message.member) return;
      if (!client.user) return;
      if (message.channel.isDMBased()) return;

      const identity: SessionIdentity = {
        guildId: message.guildId!,
        channelId: message.channelId,
        userId: message.author.id,
      };

      const channelSafety = canAutoReplyInChannel(message.channel, message.guild.members.me);
      if (!channelSafety.ok) return;

      const decision = await discordConversationSessions.resolveMessage(
        {
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
          authorIsBot: message.author.bot,
          content: message.content,
          referencedMessageId: message.reference?.messageId,
          createdAt: message.createdAt,
        },
        client.user.id,
      );
      if (!config.CONVERSATION_SESSION_ENABLED && !decision.mentioned) return;

      if (!decision.shouldHandle) {
        if (decision.reason === "empty_prompt" && decision.mentioned) {
          scheduleConversationFollowUp(identity, message.channel, () => {
            void discordConversationSessions
              .closeSession(identity.guildId, identity.channelId, identity.userId)
              .catch(() => undefined);
          });
          await message.reply({
            content: mentionUser(message.author.id, "mình nghe rồi! Bạn muốn mình làm gì?"),
            allowedMentions: { users: [message.author.id], repliedUser: true },
          });
        }
        return;
      }
      lockedSessionId = decision.session.id;

      const prompt = decision.prompt;
      if (!prompt) {
        await message.reply({
          content: mentionUser(message.author.id, "mình nghe rồi! Bạn muốn mình làm gì?"),
          allowedMentions: { users: [message.author.id], repliedUser: true },
        });
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }
      if (checkCodeAccessSafety(prompt).blocked) {
        await message.reply({ ...codeAccessSafeReply(), allowedMentions: { repliedUser: true, parse: [] } });
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }

      const guildId = message.guildId!;
      const settings = await getGuildSettings(guildId);

      if (!settings.enabled) {
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }
      if (!(await isAiChannelAllowed(settings, guildId, message.channelId))) {
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }
      if (!(await hasAllowedRole(guildId, memberRoleIds(message.member)))) {
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }
      if (!(await isUserWithinRateLimit(sessionRateLimitKey(identity)))) {
        await message.reply({
          content: mentionUser(message.author.id, "⏳ bạn đang gửi quá nhanh, thử lại sau ít phút nhé."),
          allowedMentions: { users: [message.author.id], repliedUser: true },
        });
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        return;
      }

      await message.channel.sendTyping().catch(() => undefined);

      const budget = await checkBudget(guildId);
      if (!budget.ok) {
        await message.reply({
          content: mentionUser(message.author.id, `💰 ${budget.reason}\nHạn mức sẽ reset vào ngày mai (UTC).`),
          allowedMentions: { users: [message.author.id], repliedUser: true },
        });
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        scheduleConversationFollowUp(identity, message.channel, () => {
          void discordConversationSessions
            .closeSession(identity.guildId, identity.channelId, identity.userId)
            .catch(() => undefined);
        });
        return;
      }

      const requestId = newRequestId();

      const allAttachments = [...message.attachments.values()].map((a) => ({
        url: a.url,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      }));
      const { images, skippedCount } = collectImageAttachments(allAttachments);
      const imageUrls = images.map((i) => i.url);
      let attachmentNote = describeAttachments(allAttachments);
      if (skippedCount > 0) {
        attachmentNote += `\n- (${skippedCount} ảnh bị bỏ qua do vượt giới hạn ${MAX_IMAGES_PER_REQUEST} ảnh/lượt)`;
      }

      const typingTimer = startTypingLoop(message.channel);
      let state;
      try {
        state = await runAgent({
          requestId,
          guildId,
          channelId: message.channelId,
          userId: message.author.id,
          memberRoleIds: memberRoleIds(message.member),
          input: prompt || (imageUrls.length > 0 ? "Hãy nhìn các ảnh mình gửi và mô tả, nhận xét giúp mình." : prompt),
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          attachmentNote: attachmentNote || undefined,
        });
      } catch (err) {
        logger.error({ err }, "agent run failed (mention)");
        await message.reply({
          content: mentionUser(
            message.author.id,
            "⚠️ Oops, mình gặp sự cố khi xử lý yêu cầu này. Bạn thử lại giúp mình nhé. Nếu vẫn lỗi, nhờ moderator kiểm tra log.",
          ),
          allowedMentions: { users: [message.author.id], repliedUser: true },
        });
        await discordConversationSessions.abandonTurn(decision.session.id);
        lockedSessionId = undefined;
        scheduleConversationFollowUp(identity, message.channel, () => {
          void discordConversationSessions
            .closeSession(identity.guildId, identity.channelId, identity.userId)
            .catch(() => undefined);
        });
        return;
      } finally {
        stopTypingLoop(typingTimer);
      }

      if (state.awaitingApproval && state.preview) {
        const previewMsg = await message.reply({
          content: mentionUser(message.author.id, "mình cần xác nhận trước khi thực hiện:"),
          embeds: [previewEmbed(state)],
          components: [approvalComponents(requestId, state.preview.risk)],
          allowedMentions: { users: [message.author.id], repliedUser: true },
        });
        await setPreviewMessageId(requestId, previewMsg.id);
        await discordConversationSessions.finishTurn(decision.session.id, {
          requestId,
          botMessageId: previewMsg.id,
        });
        lockedSessionId = undefined;
        scheduleConversationFollowUp(identity, message.channel, () => {
          void discordConversationSessions
            .closeSession(identity.guildId, identity.channelId, identity.userId)
            .catch(() => undefined);
        });
        return;
      }

      const response = state.finalResponse ?? "Đã xử lý xong.";
      await storeResponseSnapshot(state);
      const sentMessage = await message.reply({
        content: mentionUser(message.author.id, response),
        allowedMentions: { users: [message.author.id], repliedUser: true },
        components: [feedbackRow(requestId)],
      });
      await discordConversationSessions.finishTurn(decision.session.id, {
        requestId,
        botMessageId: sentMessage.id,
      });
      lockedSessionId = undefined;
      scheduleConversationFollowUp(identity, message.channel, () => {
        void discordConversationSessions
          .closeSession(identity.guildId, identity.channelId, identity.userId)
          .catch(() => undefined);
      });

      await writeAudit({
        requestId,
        guildId,
        actorId: message.author.id,
        action: "ai.responded",
        details: { intent: state.intent, via: decision.mentioned ? "mention" : "session" },
      });
    } catch (err) {
      if (lockedSessionId) {
        await discordConversationSessions.abandonTurn(lockedSessionId).catch(() => undefined);
      }
      logger.error({ err }, "message create handler error");
    }
  });
}
