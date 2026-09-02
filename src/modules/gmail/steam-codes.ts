import { allowedAccountMap, normalizeSteamUsername } from "@shared/steam-accounts";
import type { GmailMessage } from "@infra/gmail/types";

import { fetchSteamMessages } from "./mail";
import {
  ACCOUNT_PATTERNS,
  LABELED_CODE_PATTERN,
  NUMERIC_CODE_ONLY_PATTERN,
  STEAM_GUARD_CODE_PATTERN,
  SUBJECT_ACCOUNT_PATTERN,
} from "./patterns";
import {
  extractTextFromPayload,
  formatInternalDate,
  getHeaders,
  isSteamSender,
  normalizeWhitespace,
  redactSensitive,
  truncate,
} from "./text";
import type { ListSteamMailOptions, SteamCodeEntry } from "./types";

/**
 * Returns only `{ account, code }` pairs pulled out of Steam Guard mail.
 *
 * This path always reads the code verbatim - extracting it is the whole point
 * of the function - so GMAIL_REDACT_SENSITIVE does not apply to `code`. That
 * flag still governs the previews carried alongside it.
 */
export async function listSteamCodes(
  options: ListSteamMailOptions = {},
): Promise<SteamCodeEntry[]> {
  const { messages, gmailConfig } = await fetchSteamMessages(options);

  return messages
    .filter((message) =>
      isSteamSender(getHeaders(message.payload).from, gmailConfig.steamFrom),
    )
    .map((message) => extractSteamCode(message, gmailConfig.redactSensitive))
    .filter((entry): entry is SteamCodeEntry => entry !== null);
}

/**
 * Pulls the account name and one-time code out of a Steam Guard mail.
 * Returns null when the mail carries no code (receipts, newsletters, refunds).
 */
export function extractSteamCode(
  message: GmailMessage,
  redact = true,
): SteamCodeEntry | null {
  const text = normalizeWhitespace(
    extractTextFromPayload(message.payload) || message.snippet || "",
  );
  if (!text) return null;

  const account =
    matchAccount(text) ??
    subjectAccountFallback(message) ??
    allowedAccountFallback(text);
  const code = matchCode(text, account);
  if (!code) return null;

  const headers = getHeaders(message.payload);

  return {
    account: account ?? "(không rõ tài khoản)",
    code,
    receivedAt: formatInternalDate(message.internalDate) || headers.date || undefined,
    messageId: message.id,
    from: headers.from || undefined,
    subject: headers.subject || undefined,
    bodyPreview: truncate(redactSensitive(text, redact), 1_200) || undefined,
  };
}

/**
 * Returns the most recent Steam Guard code for one account, or null when the
 * mailbox holds none. The account is pushed into the Gmail query so the API
 * does the bulk of the filtering, and the result is re-checked locally because
 * Gmail full-text search also matches unrelated mentions of the name.
 */
export async function findLatestSteamCodeForAccount(
  account: string,
  options: ListSteamMailOptions = {},
): Promise<SteamCodeEntry | null> {
  const wanted = normalizeSteamUsername(account);
  if (!wanted) return null;

  const scopedQuery = [options.query, `"${wanted}"`].filter(Boolean).join(" ");
  const entries = await listSteamCodes({ ...options, query: scopedQuery });

  const matching = entries.filter(
    (entry) => normalizeSteamUsername(entry.account) === wanted,
  );
  if (matching.length === 0) return null;

  return matching.reduce((latest, entry) =>
    (entry.receivedAt ?? "") > (latest.receivedAt ?? "") ? entry : latest,
  );
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

/**
 * Last resort when the mail wording is in a language the patterns do not cover:
 * look for any configured Steam account name mentioned anywhere in the text and
 * return it in its canonical casing. Matching is done on normalized tokens so
 * "xardgames3" in a French mail still resolves to "XardGames3".
 */
function allowedAccountFallback(text: string): string | undefined {
  const tokens = text.match(/[A-Za-z0-9_.-]{2,64}/g);
  if (!tokens) return undefined;

  const allowed = allowedAccountMap();
  for (const token of tokens) {
    // "." and "-" are legal inside a Steam name but also end sentences, so a
    // trailing one has to come off before the lookup.
    const trimmed = token.replace(/^[.\-_]+/, "").replace(/[.\-_]+$/, "");
    if (!trimmed) continue;

    const canonical = allowed.get(normalizeSteamUsername(trimmed));
    if (canonical) return canonical;
  }

  return undefined;
}

function subjectAccountFallback(message: GmailMessage): string | undefined {
  return trimAccount(
    SUBJECT_ACCOUNT_PATTERN.exec(getHeaders(message.payload).subject)?.[1],
  );
}

/**
 * Searches after the account name where possible, since Steam puts the code
 * immediately after it - that cuts false hits on words earlier in the mail.
 */
function matchCode(text: string, account: string | undefined): string | undefined {
  const accountIndex = account ? text.indexOf(account) : -1;
  const scopes =
    accountIndex >= 0 ? [text.slice(accountIndex + account!.length), text] : [text];

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
