import { EmbedBuilder, type ButtonInteraction } from "discord.js";
import { config } from "@config";
import { deleteCodeAccessDraft, updateCodeAccessDraft } from "../../../code-access/drafts";
import { hitCodeAccessDailyLimit } from "../../../code-access/limits";
import { runEvidencePipeline } from "../../../code-access/pipeline";
import { recordRequestEvidence } from "../../../code-access/evidence";
import { evaluateCodeRequest, issueSteamCode } from "../../../code-access/service";
import { notifyCodeAccessEscalation, notifyOsMismatchWarning } from "./escalation";
import { requestRetryRow, waitingEmbed } from "./components";
import { asObject, collectImageMessages, ownedDraft } from "./interaction-utils";

export async function handleRequestButton(interaction: ButtonInteraction, action: string, draftId: string): Promise<void> {
  const draft = await ownedDraft(interaction, draftId, "request");
  if (!draft) return;
  if (!["pc", "hh", "retry"].includes(action)) return;
  await interaction.deferUpdate();
  const deviceType = action === "retry" ? String(asObject(draft.payloadJson).deviceType ?? "pc") : action;
  const expected = deviceType === "hh" ? 2 : 1;
  await interaction.editReply({
    content: deviceType === "hh"
      ? "Gửi 2 ảnh trong 10 phút: (1) màn hình Steam hỏi mã, (2) thông tin máy. Cả hai phải thấy giờ/ngày."
      : "Gửi 1 ảnh **toàn màn hình** trong 10 phút, thấy đồng thời Steam hỏi mã, Settings → System → About và đồng hồ taskbar.",
    embeds: [], components: [],
  });
  try {
    const images = await collectImageMessages(interaction, expected);
    const limited = await hitCodeAccessDailyLimit({
      guildId: draft.guildId, userId: draft.userId, userLimit: config.CODE_ACCESS_REQUEST_DAILY_LIMIT,
      guildLimit: config.CODE_ACCESS_GUILD_DAILY_LIMIT, scope: "request",
    });
    if (!limited.ok) {
      await interaction.editReply({ content: limited.reason, embeds: [], components: [] });
      return;
    }
    await interaction.editReply({ content: "Đang xác minh ảnh và thiết bị…" });
    const pipeline = await runEvidencePipeline({
      guildId: draft.guildId,
      userId: draft.userId,
      mode: deviceType === "hh" ? "request_handheld" : "request_pc",
      items: images.map((image) => ({ kind: "steam" as const, image })),
    });
    await recordRequestEvidence({ guildId: draft.guildId, userId: draft.userId, items: pipeline.evidence });
    const payload = asObject(draft.payloadJson);
    const nextPayload = { ...payload, deviceType, ocr: pipeline.ocr, evidence: pipeline.evidence };
    await updateCodeAccessDraft({ id: draft.id, userId: draft.userId, step: "verified", payload: nextPayload });
    const eligibility = await evaluateCodeRequest({
      guildId: draft.guildId,
      userId: draft.userId,
      steamUsername: String(payload.steamUsername ?? ""),
      draftId: draft.id,
      ocr: pipeline.ocr,
      evidenceKeys: pipeline.evidence.map((item) => item.s3Key),
      channelId: String(payload.channelId ?? interaction.channelId ?? ""),
    });
    if (!eligibility.ok) {
      if (eligibility.kind === "escalated" && eligibility.escalationId) {
        await notifyCodeAccessEscalation(eligibility.escalationId).catch(() => undefined);
        await interaction.editReply({ content: null, embeds: [waitingEmbed()], components: [requestRetryRow(draft.id)] });
      } else {
        const accounts = eligibility.accounts?.length ? `\nAccount của bạn: ${eligibility.accounts.map((item) => `\`${item}\``).join(", ")}` : "";
        await interaction.editReply({ content: `⛔ ${eligibility.reason}${accounts}`, embeds: [], components: [requestRetryRow(draft.id)] });
      }
      return;
    }
    const issued = await issueSteamCode({
      guildId: draft.guildId,
      userId: draft.userId,
      steamUsername: eligibility.binding.slot.steamUsername,
      ocr: pipeline.ocr,
      adminApprovedEscalationId: eligibility.adminApprovedEscalationId,
    });
    if (eligibility.osWarning) void notifyOsMismatchWarning(eligibility.binding, pipeline.ocr).catch(() => undefined);
    await deleteCodeAccessDraft(draft.id);
    const embed = new EmbedBuilder().setTitle("✅ Mã Steam Guard").setColor(0x57f287)
      .setDescription(`Account: \`${issued.account}\`\nMã: ||${issued.code}||\n\nMã hết hạn sau vài phút — hãy nhập ngay.`)
      .setFooter({ text: "Mã chỉ hiển thị trong phản hồi riêng tư này." });
    await interaction.editReply({ content: null, embeds: [embed], components: [] });
  } catch (error) {
    await interaction.editReply({
      content: `⛔ ${error instanceof Error ? error.message : "Không xử lý được yêu cầu"}`,
      embeds: [], components: [requestRetryRow(draft.id)],
    });
  }
}
