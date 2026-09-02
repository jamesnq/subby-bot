import { invokeOcr } from "@infra/ocr/client";
import { getCachedOcrResult, buildOcrCacheKey, putCachedOcrResult } from "./cache";
import { parseOcrResult } from "./parsing";
import { buildOcrPrompt, OCR_SYSTEM_PROMPT } from "./prompt";
import { OCR_PROMPT_VERSION, type CodeAccessOcrResult, type OcrImage, type OcrMode } from "./types";

export async function analyzeCodeAccessImages(input: {
  mode: OcrMode;
  images: OcrImage[];
  now?: Date;
  invoke?: typeof invokeOcr;
  readCache?: typeof getCachedOcrResult;
  writeCache?: typeof putCachedOcrResult;
}): Promise<CodeAccessOcrResult> {
  if (input.images.length === 0) throw new Error("Cần ít nhất một ảnh để OCR");
  const now = input.now ?? new Date();
  const key = buildOcrCacheKey(input.images.map((image) => image.sha256), `${input.mode}:${OCR_PROMPT_VERSION}`);
  const cached = await (input.readCache ?? getCachedOcrResult)(key, now);
  if (cached) return cached;

  const raw = await (input.invoke ?? invokeOcr)({
    systemPrompt: OCR_SYSTEM_PROMPT,
    userPrompt: buildOcrPrompt(input.mode, now),
    imageDataUrls: input.images.map((image) => image.dataUrl),
  });
  const parsed = parseOcrResult(raw);
  if (!parsed) throw new Error("OCR không trả về JSON hợp lệ; cần chụp lại hoặc chuyển admin");
  await (input.writeCache ?? putCachedOcrResult)(key, parsed, now);
  return parsed;
}
