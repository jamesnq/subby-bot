import type { GmailPayload } from "@infra/gmail/types";

import {
  ALPHANUMERIC_CODE_PATTERN,
  LINK_PATTERN,
  NUMERIC_CODE_PATTERN,
} from "./patterns";

export function getHeaders(payload: GmailPayload | undefined): {
  from: string;
  subject: string;
  date: string;
} {
  const headers = payload?.headers ?? [];

  return {
    from: findHeader(headers, "from"),
    subject: findHeader(headers, "subject"),
    date: findHeader(headers, "date"),
  };
}

function findHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return (
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

export function extractTextFromPayload(payload: GmailPayload | undefined): string {
  if (!payload) return "";

  if (payload.body?.data && isTextMime(payload.mimeType)) {
    return decodeBase64Url(payload.body.data);
  }

  const textParts = (payload.parts ?? [])
    .map((part) => extractTextFromPayload(part))
    .filter((text) => text.trim().length > 0);

  return textParts.join("\n");
}

function isTextMime(mimeType: string | undefined): boolean {
  return (
    !mimeType ||
    mimeType.startsWith("text/plain") ||
    mimeType.startsWith("text/html")
  );
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  return Buffer.from(padded, "base64").toString("utf8");
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips one-time codes and clickable links before any Steam mail text leaves
 * this module, so a Steam Guard code is not relayed into Discord.
 *
 * Disabled by GMAIL_REDACT_SENSITIVE=false, which returns codes verbatim.
 */
export function redactSensitive(value: string, redact = true): string {
  if (!redact) return value;

  return value
    .replace(LINK_PATTERN, "[redacted-link]")
    .replace(NUMERIC_CODE_PATTERN, "[redacted-code]")
    .replace(ALPHANUMERIC_CODE_PATTERN, "[redacted-code]");
}

export function formatInternalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return undefined;

  return new Date(timestamp).toISOString();
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function isSteamSender(from: string, expected: string): boolean {
  return from.toLowerCase().includes(expected.toLowerCase());
}
