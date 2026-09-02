import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "@config";

let model: ChatOpenAI | undefined;

function getOcrModel(): ChatOpenAI {
  if (!config.OCR_ENABLED) throw new Error("OCR is disabled");
  if (!config.OCR_API_KEY) throw new Error("OCR_API_KEY is required when OCR is enabled");
  model ??= new ChatOpenAI({
    apiKey: config.OCR_API_KEY,
    model: config.OCR_MODEL,
    temperature: 0,
    maxTokens: config.OCR_MAX_OUTPUT_TOKENS,
    timeout: config.OCR_TIMEOUT_MS,
    maxRetries: 1,
    configuration: { baseURL: config.OCR_BASE_URL },
  });
  return model;
}

export async function invokeOcr(input: {
  systemPrompt: string;
  userPrompt: string;
  imageDataUrls: string[];
}): Promise<unknown> {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: input.userPrompt }];
  for (const url of input.imageDataUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }
  const result = await getOcrModel().invoke([
    new SystemMessage(input.systemPrompt),
    new HumanMessage({ content }),
  ]);
  return result.content;
}
