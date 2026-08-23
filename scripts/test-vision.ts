import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

async function main() {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.LLM_MODEL ?? "stealth/ox-alpha",
    maxTokens: 2000,
    configuration: { baseURL: process.env.OPENROUTER_BASE_URL },
  });

  const msg = new HumanMessage({
    content: [
      {
        type: "text",
        text: "Đây là con gì trong ảnh? Trả lời ngắn gọn bằng tiếng Việt.",
      },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        },
      },
    ],
  });

  const res = await model.invoke([msg]);
  console.log("VISION OK:", JSON.stringify(res.content).slice(0, 300));
}

main().catch((err) => {
  console.error(
    "VISION FAILED:",
    err instanceof Error ? err.message.slice(0, 400) : err,
  );
  process.exit(1);
});

