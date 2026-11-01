import { GmailSteamMailError } from "./errors";
import type {
  ApiErrorResponse,
  GmailAuth,
  GmailListResponse,
  GmailMessage,
  TokenResponse,
} from "./types";

// Message bodies are immutable. Always list Gmail live, but avoid downloading
// the same message repeatedly across polling and concurrent user requests.
const transportCaches = new WeakMap<typeof fetch, {
  bodies: Map<string,{message:GmailMessage;expires:number}>;
  inFlight: Map<string,Promise<GmailMessage>>;
}>();
async function readMessage(fetchImpl: typeof fetch, key: string, read: () => Promise<GmailMessage>): Promise<GmailMessage> {
  let cache=transportCaches.get(fetchImpl);
  if (!cache) { cache={bodies:new Map(),inFlight:new Map()};transportCaches.set(fetchImpl,cache); }
  const {bodies,inFlight}=cache;
  const saved=bodies.get(key);
  if (saved && saved.expires > Date.now()) return saved.message;
  const pending=inFlight.get(key);
  if (pending) return pending;
  const request=read().then(message=>{
    if (bodies.size>=500) bodies.delete(bodies.keys().next().value!);
    bodies.set(key,{message,expires:Date.now()+300_000});
    return message;
  }).finally(()=>inFlight.delete(key));
  inFlight.set(key,request);
  return request;
}

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
  scanAll?: boolean;
  fetchImpl: typeof fetch;
}): Promise<GmailMessage[]> {
  const { auth, query, limit, fetchImpl } = options;
  const token = await getGmailAccessToken(auth, fetchImpl);
  const userId = encodeURIComponent(options.userId);
  const authHeader = { Authorization: `Bearer ${token}` };

  const messages: GmailMessage[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, maxResults: String(options.scanAll ? 100 : limit) });
    if (pageToken) params.set("pageToken", pageToken);
    const listed = await fetchJson<GmailListResponse>(fetchImpl,
      `${GMAIL_API_BASE}/users/${userId}/messages?${params}`, { headers: authHeader });
    const ids = listed.messages?.map(message => message.id).filter(Boolean) ?? [];
    for (let index = 0; index < ids.length; index += 10) {
      messages.push(...await Promise.all(ids.slice(index, index + 10).map(id =>
        readMessage(fetchImpl, `${auth.clientId}:${userId}:${id}`, () => fetchJson<GmailMessage>(fetchImpl,
          `${GMAIL_API_BASE}/users/${userId}/messages/${encodeURIComponent(id)}?format=full`,
          { headers: authHeader })))));

    }
    pageToken = options.scanAll ? listed.nextPageToken : undefined;
  } while (pageToken);
  return messages;
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
