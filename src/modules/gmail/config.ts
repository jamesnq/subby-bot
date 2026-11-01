import { config } from "@config";
import { GmailSteamMailError } from "@infra/gmail/errors";

import { clampInteger } from "./text";
import type { GmailSteamMailConfig } from "./types";

export function gmailConfigFromAppConfig(): GmailSteamMailConfig {
  return {
    enabled: config.GMAIL_ENABLED,
    clientId: config.GMAIL_CLIENT_ID,
    clientSecret: config.GMAIL_CLIENT_SECRET,
    refreshToken: config.GMAIL_REFRESH_TOKEN,
    userId: config.GMAIL_USER_ID,
    steamFrom: config.GMAIL_STEAM_FROM,
    queryWindowDays: config.GMAIL_STEAM_QUERY_WINDOW_DAYS,
    redactSensitive: config.GMAIL_REDACT_SENSITIVE,
  };
}

/** Fails closed: a half-configured integration must not silently read nothing. */
export function validateGmailConfig(gmailConfig: GmailSteamMailConfig): void {
  const missing = [
    ["GMAIL_CLIENT_ID", gmailConfig.clientId],
    ["GMAIL_CLIENT_SECRET", gmailConfig.clientSecret],
    ["GMAIL_REFRESH_TOKEN", gmailConfig.refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new GmailSteamMailError(`Missing Gmail config: ${missing.join(", ")}.`);
  }
}

export function buildSteamMailQuery(
  gmailConfig: GmailSteamMailConfig,
  extraQuery?: string,
  allDates = false,
): string {
  const terms = [
    `from:${gmailConfig.steamFrom}`,
    ...(allDates ? [] : [`newer_than:${clampInteger(gmailConfig.queryWindowDays, 1, 90)}d`]),
    "-in:trash",
    "-in:spam",
  ];

  if (extraQuery?.trim()) {
    terms.push(extraQuery.trim());
  }

  return terms.join(" ");
}
