import { listMessages } from "@infra/gmail/client";
import { GmailSteamMailError } from "@infra/gmail/errors";
import type { GmailMessage } from "@infra/gmail/types";

import { buildSteamMailQuery, gmailConfigFromAppConfig, validateGmailConfig } from "./config";
import {
  clampInteger,
  extractTextFromPayload,
  formatInternalDate,
  getHeaders,
  isSteamSender,
  normalizeWhitespace,
  redactSensitive,
  truncate,
} from "./text";
import type {
  GmailSteamMailConfig,
  ListSteamMailOptions,
  SteamMailMessage,
} from "./types";

/**
 * Resolves config, builds the Steam-scoped query and pulls the raw messages.
 * Shared by both the full-text reader and the code extractor.
 */
export async function fetchSteamMessages(
  options: ListSteamMailOptions,
): Promise<{ messages: GmailMessage[]; gmailConfig: GmailSteamMailConfig }> {
  const gmailConfig = options.gmailConfig ?? gmailConfigFromAppConfig();

  if (!gmailConfig.enabled) {
    throw new GmailSteamMailError("Gmail integration is disabled.");
  }

  validateGmailConfig(gmailConfig);

  const messages = await listMessages({
    auth: {
      clientId: gmailConfig.clientId,
      clientSecret: gmailConfig.clientSecret,
      refreshToken: gmailConfig.refreshToken,
    },
    userId: gmailConfig.userId,
    query: buildSteamMailQuery(gmailConfig, options.query),
    limit: clampInteger(options.limit ?? 3, 1, 5),
    fetchImpl: options.fetchImpl ?? fetch,
  });

  return { messages, gmailConfig };
}

export async function listSteamMail(
  options: ListSteamMailOptions = {},
): Promise<SteamMailMessage[]> {
  const { messages, gmailConfig } = await fetchSteamMessages(options);

  return messages
    .map((message) => parseSteamMailMessage(message, gmailConfig.redactSensitive))
    .filter((message) => isSteamSender(message.from, gmailConfig.steamFrom));
}

export function parseSteamMailMessage(
  message: GmailMessage,
  redact = true,
): SteamMailMessage {
  const headers = getHeaders(message.payload);
  const body = extractTextFromPayload(message.payload);
  const normalizedBody = redactSensitive(
    normalizeWhitespace(body || message.snippet || ""),
    redact,
  );
  const normalizedSnippet = redactSensitive(
    normalizeWhitespace(message.snippet ?? ""),
    redact,
  );

  return {
    id: message.id,
    threadId: message.threadId,
    subject: normalizeWhitespace(headers.subject || "(no subject)"),
    from: headers.from || "(unknown sender)",
    date: headers.date || "",
    internalDate: formatInternalDate(message.internalDate),
    snippet: truncate(normalizedSnippet, 280),
    bodyPreview: truncate(normalizedBody || normalizedSnippet, 1_200),
  };
}
