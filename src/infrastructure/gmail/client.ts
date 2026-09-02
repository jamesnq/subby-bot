import { GmailSteamMailError } from "./errors";
import type {
  ApiErrorResponse,
  GmailAuth,
  GmailListResponse,
  GmailMessage,
  TokenResponse,
} from "./types";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

/**
 * Thin Gmail REST client. It knows about OAuth and message fetching and
 * nothing about Steam - the domain rules for which mail matters live in
 * modules/gmail.
 */

export async function getGmailAccessToken(
  auth: GmailAuth,
  fetchImpl: typeof fetch,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: auth.clientId ?? "",
    client_secret: auth.clientSecret ?? "",
    refresh_token: auth.refreshToken ?? "",
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

    throw new GmailSteamMailError(`Could not refresh Gmail access token: ${detail}`);
  }

  return response.access_token;
}

/** Runs a Gmail search and returns the matching messages in full form. */
export async function listMessages(options: {
  auth: GmailAuth;
  userId: string;
  query: string;
  limit: number;
  fetchImpl: typeof fetch;
}): Promise<GmailMessage[]> {
  const { auth, query, limit, fetchImpl } = options;
  const token = await getGmailAccessToken(auth, fetchImpl);
  const userId = encodeURIComponent(options.userId);
  const authHeader = { Authorization: `Bearer ${token}` };

  const listUrl = `${GMAIL_API_BASE}/users/${userId}/messages?${new URLSearchParams({
    q: query,
    maxResults: String(limit),
  }).toString()}`;

  const listResponse = await fetchJson<GmailListResponse>(fetchImpl, listUrl, {
    headers: authHeader,
  });

  const messageIds =
    listResponse.messages?.map((message) => message.id).filter(Boolean) ?? [];

  return Promise.all(
    messageIds.map((id) => {
      const url = `${GMAIL_API_BASE}/users/${userId}/messages/${encodeURIComponent(
        id,
      )}?${new URLSearchParams({ format: "full" }).toString()}`;

      return fetchJson<GmailMessage>(fetchImpl, url, { headers: authHeader });
    }),
  );
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
