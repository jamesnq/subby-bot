import { z } from "zod";
import { OCR_FLAGS, type CodeAccessOcrResult } from "./types";

const nullableText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().max(500).nullable(),
);

const deviceSchema = z.object({
  deviceName: nullableText.catch(null),
  motherboard: nullableText.catch(null),
  processor: nullableText.catch(null),
  installedRam: nullableText.catch(null),
  graphicsCard: nullableText.catch(null),
  storage: nullableText.catch(null),
  deviceId: nullableText.catch(null),
  productId: nullableText.catch(null),
  systemType: nullableText.catch(null),
  osEdition: nullableText.catch(null),
  osVersion: nullableText.catch(null),
  osBuild: nullableText.catch(null),
  installedOn: nullableText.catch(null),
});

const orderSchema = z.object({
  orderCode: nullableText.catch(null),
  orderPlacedAt: nullableText.catch(null),
  orderSource: z.enum(["web", "messenger", "other"]).nullable().catch(null),
  orderTotalText: nullableText.catch(null),
  productName: nullableText.catch(null),
  planKind: z.enum(["month", "year", "lifetime"]).nullable().catch(null),
  planUnits: z.coerce.number().int().positive().max(120).nullable().catch(null),
});

const resultSchema = z.object({
  order: orderSchema.nullable().catch(null),
  device: deviceSchema,
  capturedAt: nullableText.catch(null),
  fullScreenVisible: z.boolean().catch(false),
  steamLoginPromptVisible: z.boolean().catch(false),
  confidence: z.coerce.number().min(0).max(1),
  flags: z.array(z.enum(OCR_FLAGS)).max(12).catch([]),
});

export function parseOcrResult(raw: unknown): CodeAccessOcrResult | null {
  const text = extractText(raw);
  if (!text) return null;
  const candidate = stripFence(text);
  try {
    const parsed: unknown = JSON.parse(candidate);
    const result = resultSchema.safeParse(parsed);
    if (!result.success) return null;
    return normalize(result.data);
  } catch {
    return null;
  }
}

function normalize(result: z.infer<typeof resultSchema>): CodeAccessOcrResult {
  return {
    ...result,
    order: result.order ? mapStrings(result.order) : null,
    device: mapStrings(result.device),
    capturedAt: normalizeString(result.capturedAt),
    flags: [...new Set(result.flags)],
  };
}

function mapStrings<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    typeof value === "string" ? normalizeString(value) : value,
  ])) as T;
}

function normalizeString(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function extractText(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (Array.isArray(raw)) {
    const text = raw.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    }).join("");
    return text.trim() || null;
  }
  if (raw && typeof raw === "object" && "content" in raw) return extractText(raw.content);
  return null;
}

function stripFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match?.[1] ?? text).trim();
}
