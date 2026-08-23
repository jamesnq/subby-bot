import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { config } from "../../config";
import { getPlannerModel, invokeTracked } from "../llm";
import { PLANNER_SYSTEM_PROMPT } from "../prompts";
import { toolSubsetForIntent } from "../routing";
import type { AgentState } from "../state";
import { getPlanningSpecs } from "../../tools/registry";
import { plannedCallSchema, type PlannedCall } from "../../policies/types";
import { buildExecutionContext, describeServerContext } from "../context-builder";
import { logger } from "../../observability/logger";

function planningFunction(names: string[]) {
  return [
    {
      type: "function" as const,
      function: {
        name: "propose_plan",
        description:
          "Trình bày kế hoạch các bước tool call theo thứ tự, hoặc đặt câu hỏi làm rõ khi yêu cầu mơ hồ",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "Điền câu hỏi làm rõ hoặc lý do từ chối. Chỉ dùng khi KHÔNG thể lập kế hoạch an toàn",
            },
            steps: {
              type: "array",
              description: "Các bước thực hiện theo thứ tự",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", enum: names },
                  args: { type: "object", additionalProperties: true },
                },
                required: ["name", "args"],
              },
            },
          },
          required: [],
        },
      },
    },
  ];
}

async function invokePlanner(
  model: ChatOpenAI,
  guildId: string,
  messages: [SystemMessage, HumanMessage],
  names: string[],
): Promise<{ steps: PlannedCall[]; question?: string }> {
  const bound = model.bindTools(planningFunction(names), {
    tool_choice: { type: "function", function: { name: "propose_plan" } },
  });

  let response;
  try {
    response = await invokeTracked(bound, guildId, messages);
  } catch {
    const fallback = model.bindTools(planningFunction(names));
    response = await invokeTracked(fallback, guildId, messages);
  }

  const toolCall = response.tool_calls?.find((tc) => tc.name === "propose_plan");
  if (!toolCall) {
    const text =
      typeof response.content === "string"
        ? response.content
        : "Mình chưa hiểu yêu cầu này.";
    return { steps: [], question: text };
  }

  const args = toolCall.args as {
    question?: string;
    steps?: unknown;
  };

  const steps: PlannedCall[] = [];
  let firstInvalidReason: string | undefined;
  if (Array.isArray(args.steps)) {
    for (const raw of args.steps.slice(0, config.MAX_TOOL_CALLS_PER_REQUEST)) {
      const parsed = plannedCallSchema.safeParse(raw);
      if (parsed.success) steps.push(parsed.data);
      else if (!firstInvalidReason) firstInvalidReason = "cấu trúc bước không đúng định dạng";
    }
  }

  return { steps, question: args.question ?? (firstInvalidReason ? `Một số bước trong kế hoạch bị lỗi (${firstInvalidReason}).` : undefined) };
}

export async function planTools(state: AgentState): Promise<Partial<AgentState>> {
  const intent = state.intent ?? "action";
  const names = toolSubsetForIntent(intent);
  if (names.length === 0) {
    return { directAnswer: "Mình chưa hỗ trợ yêu cầu dạng này." };
  }

  const specs = getPlanningSpecs(names);
  const catalog = specs
    .map((s) => `- ${s.function.name} [${s.function.description}]\n  args schema: ${JSON.stringify(s.function.parameters)}`)
    .join("\n");

  const ec = await buildExecutionContext(state);
  const serverContext = await describeServerContext(ec.guild, state.channelId);

  try {
    const result = await invokePlanner(
      getPlannerModel(),
      state.guildId,
      [
        new SystemMessage(`${PLANNER_SYSTEM_PROMPT}\n\nTOOLS CATALOG:\n${catalog}`),
        new HumanMessage(`CONTEXT SERVER:\n${serverContext}\n\n<user_request>\n${state.input}\n</user_request>`),
      ],
      names,
    );

    if (result.steps.length === 0) {
      return { directAnswer: result.question ?? "Mình cần thêm thông tin để thực hiện yêu cầu này." };
    }
    return { proposedCalls: result.steps };
  } catch (err) {
    logger.error({ err }, "planner invocation failed");
    return {
      error: "⚠️ Mình chưa kết nối được AI để lập kế hoạch. Vui lòng thử lại sau ít phút nhé!",
    };
  }
}

