import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";

async function main() {
  const model = new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.LLM_MODEL ?? "stealth/ox-alpha",
    temperature: 0,
    maxTokens: 50,
    configuration: { baseURL: process.env.OPENROUTER_BASE_URL },
  });
  console.log("Testing model:", process.env.LLM_MODEL ?? "(default)");
  const res = await model.invoke("Trả lời đúng 1 từ: 2+2=?");
  console.log("OK:", JSON.stringify(res.content));
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
