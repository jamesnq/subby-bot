import "dotenv/config";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { PLANNER_SYSTEM_PROMPT } from "../src/agent/prompts";
import { createCategoryTool } from "../src/tools/categories/create-category";
import { createChannelTool } from "../src/tools/channels/create-channel";
import { toPlanningSpec, type PlanningToolSpec } from "../src/tools/registry";

const NAMES = ["create_category", "create_channel"];

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

async function main() {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.LLM_MODEL ?? "stealth/ox-alpha",
    temperature: 0,
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 60_000),
    configuration: { baseURL: process.env.OPENROUTER_BASE_URL },
  });
  console.log("Testing model:", process.env.LLM_MODEL ?? "(default)");

  const specs: PlanningToolSpec[] = [
    toPlanningSpec(createCategoryTool),
    toPlanningSpec(createChannelTool),
  ];
  const catalog = specs
    .map((s) => `- ${s.function.name} [${s.function.description}]\n  args schema: ${JSON.stringify(s.function.parameters)}`)
    .join("\n");

  const bound = model.bindTools(planningFunction(NAMES), {
    tool_choice: { type: "function", function: { name: "propose_plan" } },
  });

  const startedAt = Date.now();
  const res = await bound.invoke([
    new SystemMessage(`${PLANNER_SYSTEM_PROMPT}\n\nTOOLS CATALOG:\n${catalog}`),
    new HumanMessage(
      'CONTEXT SERVER:\nServer: Test Guild\nCategory "Học Tập" (id 111): (trống)\n\nYÊU CẦU:\nTạo category Học Tập với 2 channel #thao-luan và #tai-lieu',
    ),
  ]);

  console.log(`elapsed: ${Date.now() - startedAt}ms`);
  const call = res.tool_calls?.find((tc) => tc.name === "propose_plan");
  if (!call) {
    console.log("NO tool_call. content:", JSON.stringify(res.content));
    process.exit(1);
  }
  const args = call.args as { question?: string; steps?: unknown };
  if (args.question) {
    console.log("question:", args.question);
  }
  console.log("steps:", JSON.stringify(args.steps, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
