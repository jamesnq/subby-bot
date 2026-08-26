import { config } from "../config";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

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

type GmailListResponse = {
  messages?: Array<{ id: string; threadId?: string }>;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type ApiErrorResponse = {
  error?: string | { message?: string };
};

export class GmailSteamMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailSteamMailError";
  }
}

export async function listSteamMail(
  options: ListSteamMailOptions = {},
): Promise<SteamMailMessage[]> {
  const { messages, gmailConfig } = await fetchSteamMessages(options);

  return messages
    .map((message) => parseSteamMailMessage(message, gmailConfig.redactSensitive))
    .filter((message) => isSteamSender(message.from, gmailConfig.steamFrom));
}

/**
 * Returns only `{ account, code }` pairs pulled out of Steam Guard mail.
 *
 * This path always reads the code verbatim - extracting it is the whole point
 * of the function - so GMAIL_REDACT_SENSITIVE does not apply here. That flag
 * still governs the full-text previews from listSteamMail().
 */
export async function listSteamCodes(
  options: ListSteamMailOptions = {},
): Promise<SteamCodeEntry[]> {
  const { messages, gmailConfig } = await fetchSteamMessages(options);

  return messages
    .filter((message) =>
      isSteamSender(getHeaders(message.payload).from, gmailConfig.steamFrom),
    )
    .map((message) => extractSteamCode(message))
    .filter((entry): entry is SteamCodeEntry => entry !== null);
}

async function fetchSteamMessages(
  options: ListSteamMailOptions,
): Promise<{ messages: GmailMessage[]; gmailConfig: GmailSteamMailConfig }> {
  const gmailConfig = options.gmailConfig ?? gmailConfigFromAppConfig();

  if (!gmailConfig.enabled) {
    throw new GmailSteamMailError("Gmail integration is disabled.");
  }

  validateGmailConfig(gmailConfig);

  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = clampInteger(options.limit ?? 3, 1, 5);
  const token = await getGmailAccessToken(gmailConfig, fetchImpl);
  const userId = encodeURIComponent(gmailConfig.userId);
  const gmailQuery = buildSteamMailQuery(gmailConfig, options.query);

  const listUrl = `${GMAIL_API_BASE}/users/${userId}/messages?${new URLSearchParams(
    {
      q: gmailQuery,
      maxResults: String(limit),
    },
  ).toString()}`;

  const listResponse = await fetchJson<GmailListResponse>(fetchImpl, listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const messageIds =
    listResponse.messages?.map((message) => message.id).filter(Boolean) ?? [];

  const messages = await Promise.all(
    messageIds.map(async (id) => {
      const url = `${GMAIL_API_BASE}/users/${userId}/messages/${encodeURIComponent(id)}?${new URLSearchParams(
        {
          format: "full",
        },
      ).toString()}`;

      return fetchJson<GmailMessage>(fetchImpl, url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }),
  );

  return { messages, gmailConfig };
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

const ACCOUNT_PATTERNS = [
  /(?:log\s?in|login|sign\s?in)\s+to\s+(?:the\s+)?account\s+([A-Za-z0-9_.-]{2,64})/i,
  /\baccount\s+([A-Za-z0-9_.-]{2,64})\s*[:,]/i,
  /\bt[àa]i\s?kho[ảa]n\s+([A-Za-z0-9_.-]{2,64})/i,
  /(?:^|\s)(?:Dear|Xin ch[àa]o|Ch[àa]o)\s+([A-Za-z0-9_.-]{2,64})\s*[,:]/i,
];

/** Steam Guard alphabet - omits characters that misread (0/O, 1/I/L, S/5...). */
const STEAM_GUARD_CODE_PATTERN = /\b[23456789BCDFGHJKMNPQRTVWXY]{5}\b/;
/** "code: DN356", "mã: DN356" - deliberately case-sensitive on the code group. */
const LABELED_CODE_PATTERN =
  /(?:[Cc]ode|[Mm][aã])\s*(?:is|l[àa])?\s*[:：]?\s*([A-Z0-9]{5,8})\b/;
const NUMERIC_CODE_ONLY_PATTERN = /\b(\d{5,8})\b/;

/**
 * Pulls the account name and one-time code out of a Steam Guard mail.
 * Returns null when the mail carries no code (receipts, newsletters, refunds).
 */
export function extractSteamCode(message: GmailMessage): SteamCodeEntry | null {
  const text = normalizeWhitespace(
    extractTextFromPayload(message.payload) || message.snippet || "",
  );
  if (!text) return null;

  const account = matchAccount(text) ?? subjectAccountFallback(message);
  const code = matchCode(text, account);
  if (!code) return null;

  return {
    account: account ?? "(không rõ tài khoản)",
    code,
    receivedAt:
      formatInternalDate(message.internalDate) ||
      getHeaders(message.payload).date ||
      undefined,
  };
}

export function formatSteamCodeLine(entry: SteamCodeEntry): string {
  return `${entry.account}: ${entry.code}`;
}

function matchAccount(text: string): string | undefined {
  for (const pattern of ACCOUNT_PATTERNS) {
    const account = trimAccount(pattern.exec(text)?.[1]);
    if (account) return account;
  }

  return undefined;
}

/** Account charset allows `.` and `-`, so sentence punctuation can ride along. */
function trimAccount(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/[._-]+$/, "");

  return trimmed ? trimmed : undefined;
}

function subjectAccountFallback(message: GmailMessage): string | undefined {
  const subject = getHeaders(message.payload).subject;
  const match = /\b(?:account|t[àa]i kho[ảa]n)\s+([A-Za-z0-9_.-]{2,64})/i.exec(
    subject,
  );

  return trimAccount(match?.[1]);
}

/**
 * Searches after the account name where possible, since Steam puts the code
 * immediately after it - that cuts false hits on words earlier in the mail.
 */
function matchCode(text: string, account: string | undefined): string | undefined {
  const accountIndex = account ? text.indexOf(account) : -1;
  const scopes =
    accountIndex >= 0
      ? [text.slice(accountIndex + account!.length), text]
      : [text];

  for (const scope of scopes) {
    const labeled = LABELED_CODE_PATTERN.exec(scope);
    if (labeled?.[1]) return labeled[1];

    const guard = STEAM_GUARD_CODE_PATTERN.exec(scope);
    if (guard?.[0]) return guard[0];

    const numeric = NUMERIC_CODE_ONLY_PATTERN.exec(scope);
    if (numeric?.[1]) return numeric[1];
  }

  return undefined;
}

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

function validateGmailConfig(gmailConfig: GmailSteamMailConfig): void {
  const missing = [
    ["GMAIL_CLIENT_ID", gmailConfig.clientId],
    ["GMAIL_CLIENT_SECRET", gmailConfig.clientSecret],
    ["GMAIL_REFRESH_TOKEN", gmailConfig.refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new GmailSteamMailError(
      `Missing Gmail config: ${missing.join(", ")}.`,
    );
  }
}

async function getGmailAccessToken(
  gmailConfig: GmailSteamMailConfig,
  fetchImpl: typeof fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: gmailConfig.clientId ?? "",
    client_secret: gmailConfig.clientSecret ?? "",
    refresh_token: gmailConfig.refreshToken ?? "",
    grant_type: "refresh_token",
  });

  const response = await fetchJson<TokenResponse>(fetchImpl, GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.access_token) {
    const detail =
      response.error_description ||
      response.error ||
      "token response did not include access_token";

    throw new GmailSteamMailError(
      `Could not refresh Gmail access token: ${detail}`,
    );
  }

  return response.access_token;
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, init);
  const text = await response.text();

  let data: T & ApiErrorResponse;

  try {
    data = text
      ? (JSON.parse(text) as T & ApiErrorResponse)
      : ({} as T & ApiErrorResponse);
  } catch {
    throw new GmailSteamMailError(
      `Gmail API returned invalid JSON (${response.status}).`,
    );
  }

  if (!response.ok) {
    const detail =
      typeof data.error === "object" && data.error
        ? data.error.message || response.statusText
        : data.error || response.statusText;

    throw new GmailSteamMailError(
      `Gmail API request failed (${response.status}): ${detail}`,
    );
  }

  return data as T;
}

function buildSteamMailQuery(
  gmailConfig: GmailSteamMailConfig,
  extraQuery?: string,
): string {
  const terms = [
    `from:${gmailConfig.steamFrom}`,
    `newer_than:${clampInteger(gmailConfig.queryWindowDays, 1, 90)}d`,
    "-in:trash",
    "-in:spam",
  ];

  if (extraQuery?.trim()) {
    terms.push(extraQuery.trim());
  }

  return terms.join(" ");
}

function getHeaders(payload: GmailPayload | undefined): {
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

function extractTextFromPayload(payload: GmailPayload | undefined): string {
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

function normalizeWhitespace(value: string): string {
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

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const NUMERIC_CODE_PATTERN = /\b\d{5,}\b/g;
const ALPHANUMERIC_CODE_PATTERN =
  /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,12}\b/g;

/**
 * Strips one-time codes and clickable links before any Steam mail text leaves
 * this module, so a Steam Guard code is not relayed into Discord.
 *
 * Disabled by GMAIL_REDACT_SENSITIVE=false, which returns codes verbatim.
 */
function redactSensitive(value: string, redact = true): string {
  if (!redact) return value;

  return value
    .replace(LINK_PATTERN, "[redacted-link]")
    .replace(NUMERIC_CODE_PATTERN, "[redacted-code]")
    .replace(ALPHANUMERIC_CODE_PATTERN, "[redacted-code]");
}

function formatInternalDate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return undefined;

  return new Date(timestamp).toISOString();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isSteamSender(from: string, expected: string): boolean {
  return from.toLowerCase().includes(expected.toLowerCase());
}
