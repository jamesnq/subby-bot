export type GmailSteamMailConfig = {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  userId: string;
  steamFrom: string;
  queryWindowDays: number;
  /** Defaults to true. When false, Steam Guard codes and links are returned verbatim. */
  redactSensitive?: boolean;
};

export type ListSteamMailOptions = {
  limit?: number;
  query?: string;
  fetchImpl?: typeof fetch;
  gmailConfig?: GmailSteamMailConfig;
};

export type SteamCodeEntry = {
  /** Steam account the code belongs to, e.g. "XardGames1". */
  account: string;
  /** The one-time code itself, e.g. "DN356". */
  code: string;
  receivedAt?: string;
  /** Gmail message id - the dedupe key for the mail cache. */
  messageId?: string;
  from?: string;
  subject?: string;
  /**
   * Redacted preview of the mail body. The code itself lives in `code`;
   * this field must never carry a second, unredacted copy of it.
   */
  bodyPreview?: string;
};

export type SteamMailMessage = {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  date: string;
  internalDate?: string;
  snippet: string;
  bodyPreview: string;
};
