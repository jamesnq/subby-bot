import { ChatOpenAI } from "@langchain/openai";
import type { ChatOpenAICallOptions } from "@langchain/openai";
import type { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessageChunk } from "@langchain/core/messages";
import { config } from "@config";
import { recordLlmUsage, } from "./usage";
import { incLlmCall } from "../observability/metrics";
import { logger } from "@shared/logger";

const defaultHeaders = {
  "HTTP-Referer": "https://github.com/discord-server-builder",
  "X-Title": "Discord AI Server Manager",
};

export function getPlannerModel(): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    model: config.LLM_MODEL,
    temperature: 0,
    maxTokens: 4096,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 1,
    configuration: {
      baseURL: config.OPENROUTER_BASE_URL,
      defaultHeaders,
    },
  });
}

export function getSmallModel(): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    model: config.LLM_SMALL_MODEL,
    temperature: 0,
    maxTokens: 512,
    timeout: Math.min(config.LLM_TIMEOUT_MS, 30_000),
    maxRetries: 1,
    configuration: {
      baseURL: config.OPENROUTER_BASE_URL,
      defaultHeaders,
    },
  });
}

export async function invokeTracked(
  model: Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>,
  guildId: string,
  messages: BaseLanguageModelInput,
): Promise<AIMessageChunk> {
  const startedAt = Date.now();
  try {
    const response = await model.invoke(messages);
    const meta = (response.usage_metadata ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
    };
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 10_000) {
      logger.warn({ guildId, elapsedMs }, "slow LLM call");
    }
    incLlmCall();
    await recordLlmUsage(guildId, meta.input_tokens ?? 0, meta.output_tokens ?? 0);
    return response;
  } catch (err) {
    logger.error(
      { err, guildId, elapsedMs: Date.now() - startedAt },
      "LLM call failed",
    );
    throw err;
  }
}
