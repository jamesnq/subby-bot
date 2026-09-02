import { z } from "zod";
import { EMPTY_DEVICE_FINGERPRINT, type VisionVerificationFields } from "./types";

const resultSchema = z.object({
  fullScreenVisible: z.boolean().catch(false),
  dateTimeVisible: z.boolean().catch(false),
  purchaseLooksValid: z.boolean().catch(false),
  durationMonths: z.number().int().positive().max(120).nullable().catch(null),
  purchaseDate: z.string().nullable().catch(null),
  expiresAt: z.string().nullable().catch(null),
  deviceFingerprint: z
    .object({
      deviceName: z.string().nullable().catch(null),
      platform: z.string().nullable().catch(null),
      model: z.string().nullable().catch(null),
      osVersion: z.string().nullable().catch(null),
      serialNumber: z.string().nullable().catch(null),
      imei: z.string().nullable().catch(null),
      meid: z.string().nullable().catch(null),
      androidId: z.string().nullable().catch(null),
      udid: z.string().nullable().catch(null),
      hardwareId: z.string().nullable().catch(null),
      rawVisibleIdentifiers: z.array(z.string()).catch([]),
    })
    .catch(EMPTY_DEVICE_FINGERPRINT),
  confidence: z.number().min(0).max(1).catch(0),
  reasons: z.array(z.string()).catch([]),
});

export function parseVisionResult(raw: unknown): VisionVerificationFields | null {
  const text = extractText(raw);
  const json = extractJsonObject(text);
  if (!json) return null;

  try {
    return normalizeParsedVisionResult(resultSchema.parse(JSON.parse(json)));
  } catch {
    return null;
  }
}

function normalizeParsedVisionResult(
  parsed: z.infer<typeof resultSchema>,
): VisionVerificationFields {
  const deviceFingerprint = {
    ...EMPTY_DEVICE_FINGERPRINT,
    ...parsed.deviceFingerprint,
    rawVisibleIdentifiers: parsed.deviceFingerprint?.rawVisibleIdentifiers ?? [],
  };

  return {
    fullScreenVisible: parsed.fullScreenVisible ?? false,
    dateTimeVisible: parsed.dateTimeVisible ?? false,
    purchaseLooksValid: parsed.purchaseLooksValid ?? false,
    durationMonths: parsed.durationMonths ?? null,
    purchaseDate: parsed.purchaseDate ?? null,
    expiresAt: parsed.expiresAt ?? null,
    deviceFingerprint,
    confidence: parsed.confidence ?? 0,
    reasons: parsed.reasons ?? [],
  };
}

function extractText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String(part.text);
        }
        return "";
      })
      .join("\n");
  }
  return JSON.stringify(raw);
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function parseDurationMonths(text: string): number | null {
  const normalized = decodeURIComponent(text).toLowerCase();
  const match = normalized.match(
    /(\d{1,3})[\s._-]*(?:months?|mos?|mo|thang|tháng|m)\b/,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 && value <= 120 ? value : null;
}

export function parseDateFromText(text: string): string | null {
  const normalized = decodeURIComponent(text);
  const isoMatch = normalized.match(/\b(20\d{2})[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return normalizeDate(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);

  const compactMatch = normalized.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactMatch) {
    return normalizeDate(`${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`);
  }

  return null;
}

export function parseExpiryDateFromText(text: string): string | null {
  const normalized = decodeURIComponent(text).toLowerCase();
  const expiryMatch = normalized.match(
    /(?:exp|expires|expiry|until)[-_\s:]*(20\d{2}[-_.](?:0[1-9]|1[0-2])[-_.](?:0[1-9]|[12]\d|3[01]))/,
  );
  return expiryMatch ? normalizeDate(expiryMatch[1].replace(/[_.]/g, "-")) : null;
}

export function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date);
}

export function addMonths(isoDate: string, months: number): string | null {
  const normalized = normalizeDate(isoDate);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const maxDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, maxDay));
  return formatDate(date);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function firstNonNull<T>(values: Array<T | null>): T | null {
  for (const value of values) {
    if (value !== null) return value;
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
