import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getPlannerModel, invokeTracked } from "../llm";
import { CHAT_PROMPT, KNOWLEDGE_ANSWER_PROMPT } from "../prompts";
import { buildExecutionContext, describeServerContext } from "../context-builder";
import { sanitizeKnowledgeText, stripPublicCitations } from "@shared/sanitize";
import { storeCachedAnswer } from "../../knowledge/cache";
import { answerProductPriceQuery } from "../../knowledge/product-answer";
import { buildMultimodalContent } from "@shared/media";
import { buildConversationSessionScope, buildSessionHistoryPrompt } from "../session-context";
import { logger } from "@shared/logger";
import type { AgentState } from "../state";

export function formatActionSummary(state: AgentState): string {
  const results = state.toolResults ?? [];
  if (results.length === 0) {
    return "Không có bước nào được thực hiện.";
  }

  const lines: string[] = [];
  let firstFailIndex = -1;
  for (const step of results) {
    if (step.status === "success" || step.status === "skipped_idempotent") {
      lines.push(`✅ ${step.summary}`);
    } else if (step.status === "denied") {
      firstFailIndex = step.index;
      lines.push(`⛔ Bước ${step.index + 1} bị chặn: ${step.error}`);
    } else {
      firstFailIndex = step.index;
      lines.push(`❌ Bước ${step.index + 1} thất bại: ${step.error}`);
    }
    if (firstFailIndex >= 0) break;
  }

  const failed = firstFailIndex >= 0;
  const header = failed
    ? "⚠️ Một số bước không hoàn tất:"
    : `✅ Hoàn tất ${results.length} bước:`;

  const skippedNote =
    failed && state.proposedCalls && state.proposedCalls.length > firstFailIndex + 1
      ? `\n\n⏸️ Các bước chưa thực hiện: ${state.proposedCalls
          .slice(firstFailIndex + 1)
          .map((c) => c.name)
          .join(", ")}. Sửa nguyên nhân rồi thử lại nhé!`
      : "";

  const guidance = failed ? "\n👉 Kiểm tra lại thông tin/quyền rồi gửi lại yêu cầu nhé." : "";

  return [header, ...lines].join("\n") + skippedNote + guidance;
}

async function knowledgeAnswer(state: AgentState): Promise<string> {
  const chunks = state.retrievedContext ?? [];

  if (chunks.length === 0) {
    return [
      "🤔 Mình chưa tìm thấy thông tin phù hợp trong cơ sở tri thức của server.",
      "",
      "Bạn có thể:",
      "• diễn đạt câu hỏi theo cách khác",
      "• nhờ moderator thêm tài liệu vào knowledge base (`npm run ingest`)",
    ].join("\n");
  }

  const citations = [...new Set(chunks.map((c) => sanitizeKnowledgeText(c.title)))];
  const productAnswer = answerProductPriceQuery(state.input, chunks);
  if (productAnswer) {
    await storeCachedAnswer(
      state.guildId,
      state.input,
      productAnswer,
      citations,
      state.memberRoleIds,
    );
    return productAnswer;
  }

  const contextBlock = chunks
    .map(
      (c, i) =>
        `<data id="${i + 1}">\n${sanitizeKnowledgeText(c.content)}\n</data>`,
    )
    .join("\n\n");

  try {
    const response = await invokeTracked(getPlannerModel(), state.guildId, [
      new SystemMessage(KNOWLEDGE_ANSWER_PROMPT),
      new HumanMessage(`NGỮ CẢNH:\n${contextBlock}\n\nCÂU HỎI: ${state.input}`),
    ]);
    const text =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    const publicText = stripPublicCitations(text);

    await storeCachedAnswer(
      state.guildId,
      state.input,
      publicText,
      citations,
      state.memberRoleIds,
    );

    return publicText;
  } catch (err) {
    logger.warn({ err }, "knowledge answer LLM failed");
    return "Mình tìm thấy dữ liệu liên quan nhưng đang gặp lỗi khi tổng hợp câu trả lời. Bạn hỏi lại ngắn hơn một chút, hoặc chờ shop kiểm tra giúp nhé.";
  }
}

async function chatAnswer(state: AgentState): Promise<string> {
  try {
    let serverLine = "";
    try {
      const ec = await buildExecutionContext(state);
      serverLine = await describeServerContext(ec.guild, state.channelId);
    } catch {
      serverLine = "";
    }

    const history = await buildSessionHistoryPrompt(buildConversationSessionScope(state));

    let userText = `${history}[Bối cảnh server]\n${serverLine}\n\n<user_request>\n${state.input}\n</user_request>`;
    if (state.attachmentNote) {
      userText += `\n\nĐÍNH KÈM (chỉ biết metadata, không xem được nội dung):\n${sanitizeKnowledgeText(state.attachmentNote)}`;
      userText += "\nNếu là video: nói với người dùng rằng mình chưa xem trực tiếp được video, gợi ý họ mô tả hoặc gửi vài khung hình dưới dạng ảnh.";
    }

    const imageUrls = state.imageUrls ?? [];
    if (imageUrls.length > 0) {
      try {
        const response = await invokeTracked(getPlannerModel(), state.guildId, [
          new SystemMessage(CHAT_PROMPT),
          new HumanMessage({
            content: buildMultimodalContent(userText, imageUrls),
          }),
        ]);
        return typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);
      } catch (err) {
        logger.warn({ err }, "multimodal LLM call failed, retrying text-only");
        userText += `\n\n(người dùng đã gửi ${imageUrls.length} ảnh nhưng model hiện tại không xem được ảnh, hãy trả lời dựa trên văn bản và gợi ý họ thử lại sau)`;
      }
    }

    const response = await invokeTracked(getPlannerModel(), state.guildId, [
      new SystemMessage(CHAT_PROMPT),
      new HumanMessage(userText),
    ]);
    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  } catch (err) {
    logger.warn({ err }, "chat answer LLM failed");
    return "⚠️ Mình đang gặp sự cố khi kết nối tới model AI. Vui lòng thử lại sau.";
  }
}

export async function composeResponse(state: AgentState): Promise<Partial<AgentState>> {
  if (state.finalResponse && !state.cachedAnswer) {
    return {};
  }
  if (state.error) {
    const friendly = state.error.includes("⚠️") || state.error.includes("🚫")
      ? state.error
      : `${state.error}\n👉 Kiểm tra lại thông tin rồi thử lại nhé.`;
    return { finalResponse: friendly };
  }
  if (state.awaitingApproval) {
    return { finalResponse: undefined };
  }
  if (state.directAnswer) {
    return { finalResponse: state.directAnswer };
  }
  if (state.cachedAnswer) {
    return { finalResponse: stripPublicCitations(state.cachedAnswer) };
  }
  if (state.toolResults) {
    return { finalResponse: formatActionSummary(state) };
  }
  if (state.intent === "knowledge") {
    return { finalResponse: await knowledgeAnswer(state) };
  }
  return { finalResponse: await chatAnswer(state) };
}
