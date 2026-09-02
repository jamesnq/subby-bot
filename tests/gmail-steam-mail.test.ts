import { describe, expect, it, vi } from "vitest";
import {
  GmailSteamMailError,
  extractSteamCode,
  findLatestSteamCodeForAccount,
  formatSteamCodeLine,
  listSteamCodes,
  listSteamMail,
  parseSteamMailMessage,
  type GmailSteamMailConfig,
} from "../src/modules/gmail/steam-mail";

const baseConfig: GmailSteamMailConfig = {
  enabled: true,
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  userId: "me",
  steamFrom: "noreply@steampowered.com",
  queryWindowDays: 14,
};

describe("Steam Gmail reader", () => {
  it("protects Steam Guard and login codes before returning parsed text", () => {
    const parsed = parseSteamMailMessage({
      id: "message-0",
      snippet: "Login code: 123456",
      payload: {
        headers: [
          { name: "From", value: "Steam <noreply@steampowered.com>" },
          { name: "Subject", value: "Steam Guard" },
        ],
        body: {
          data: base64Url("Your Steam Guard code is A1B2C. Visit https://store.steampowered.com/account"),
        },
        mimeType: "text/plain",
      },
    });

    expect(parsed.bodyPreview).toContain("[redacted-code]");
    expect(parsed.bodyPreview).toContain("[redacted-link]");
    expect(parsed.bodyPreview).not.toContain("A1B2C");
    expect(parsed.snippet).not.toContain("123456");
    expect(parsed.bodyPreview).not.toContain("https://store.steampowered.com/account");
  });

  it("parses nested Gmail payload text and redacts body content", () => {
    const parsed = parseSteamMailMessage({
      id: "message-1",
      threadId: "thread-1",
      snippet: "Steam Guard code is 777777",
      internalDate: "1760000000000",
      payload: {
        headers: [
          { name: "From", value: "Steam <noreply@steampowered.com>" },
          { name: "Subject", value: "Your Steam account" },
          { name: "Date", value: "Wed, 26 Aug 2026 08:00:00 +0000" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  data: base64Url("Steam Guard code: ZX91Q\nDevice info: Windows"),
                },
              },
            ],
          },
        ],
      },
    });

    expect(parsed.from).toBe("Steam <noreply@steampowered.com>");
    expect(parsed.bodyPreview).toContain("Device info: Windows");
    expect(parsed.bodyPreview).toContain("[redacted-code]");
    expect(parsed.bodyPreview).not.toContain("ZX91Q");
    expect(parsed.snippet).not.toContain("777777");
  });

  it("uses OAuth refresh token and Gmail message APIs", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlText = String(url);
      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token" });
      }
      if (urlText.includes("/messages?")) {
        const query = new URL(urlText).searchParams.get("q") ?? "";
        expect(query).toContain("from:noreply@steampowered.com newer_than:14d");
        expect(query).toContain("subject:Steam");
        return jsonResponse({ messages: [{ id: "message-1", threadId: "thread-1" }] });
      }
      if (urlText.includes("/messages/message-1?")) {
        return jsonResponse({
          id: "message-1",
          threadId: "thread-1",
          snippet: "Latest Steam notification",
          payload: {
            headers: [
              { name: "From", value: "Steam <noreply@steampowered.com>" },
              { name: "Subject", value: "Steam notification" },
              { name: "Date", value: "Wed, 26 Aug 2026 08:00:00 +0000" },
            ],
            body: {
              data: base64Url("Your security code is 654321"),
            },
            mimeType: "text/plain",
          },
        });
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    }) as unknown as typeof fetch;

    const messages = await listSteamMail({
      limit: 2,
      query: "subject:Steam",
      fetchImpl,
      gmailConfig: baseConfig,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe("Steam notification");
    expect(messages[0].bodyPreview).toContain("[redacted-code]");
    expect(messages[0].bodyPreview).not.toContain("654321");
  });

  it("returns verbatim text when redaction is explicitly disabled", () => {
    const message = {
      id: "message-2",
      snippet: "Login code: 123456",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: { data: base64Url("Your Steam Guard code is A1B2C.") },
      },
    };

    expect(parseSteamMailMessage(message, false).bodyPreview).toContain("A1B2C");
    expect(parseSteamMailMessage(message, false).snippet).toContain("123456");

    // Omitting the flag must keep redaction on - the safe default.
    expect(parseSteamMailMessage(message).bodyPreview).not.toContain("A1B2C");
  });

  it("extracts account name and code from Steam Guard mail", () => {
    const entry = extractSteamCode({
      id: "code-1",
      internalDate: "1760000000000",
      payload: {
        headers: [
          { name: "From", value: "Steam <noreply@steampowered.com>" },
          { name: "Subject", value: "Your Steam account: Access from new device" },
        ],
        mimeType: "text/plain",
        body: {
          data: base64Url(
            "Dear XardGames1,\nHere's the Steam Guard code you need to login to account XardGames1:\nDN356\nThis email was generated for you.",
          ),
        },
      },
    });

    expect(entry).not.toBeNull();
    expect(formatSteamCodeLine(entry!)).toBe("XardGames1: DN356");
  });

  it("extracts labeled and Vietnamese-worded codes", () => {
    const labeled = extractSteamCode({
      id: "code-2",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: { data: base64Url("Login to account shopgame_02. Code: 7KQ4B") },
      },
    });
    expect(formatSteamCodeLine(labeled!)).toBe("shopgame_02: 7KQ4B");

    const vietnamese = extractSteamCode({
      id: "code-3",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: { data: base64Url("Đăng nhập vào tài khoản XardGames9, mã: 903124") },
      },
    });
    expect(formatSteamCodeLine(vietnamese!)).toBe("XardGames9: 903124");
  });

  it("uses the allowed account token when localized mail wording is unfamiliar", () => {
    const entry = extractSteamCode({
      id: "code-localized",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: {
          data: base64Url(
            "Votre compte Steam : accès depuis un nouvel ordinateur - Steam xardgames3. Voici votre code Steam Guard QR234.",
          ),
        },
      },
    });

    expect(formatSteamCodeLine(entry!)).toBe("XardGames3: QR234");
  });

  it("returns null for Steam mail that carries no code", () => {
    const entry = extractSteamCode({
      id: "code-4",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: {
          data: base64Url("Thank you for your purchase. Your receipt is attached."),
        },
      },
    });

    expect(entry).toBeNull();
  });

  it("regression: never returns an unrelated bare number as the code (a real Steam Guard code always uses the restricted alphabet)", () => {
    // Unlabeled mail (no "code"/"mã" wording the LABELED pattern can anchor
    // on - e.g. a non-English template) that happens to contain some
    // unrelated 5-digit number (a ticket/reference id, here). There used to
    // be a `\b\d{5,8}\b` last-resort fallback that would grab this number
    // and hand it out as if it were the Guard code.
    const entry = extractSteamCode({
      id: "code-5",
      payload: {
        headers: [{ name: "From", value: "Steam <noreply@steampowered.com>" }],
        mimeType: "text/plain",
        body: {
          data: base64Url("Account XardGames2 - request reference 98009. See help center article 12345 for details."),
        },
      },
    });

    expect(entry).toBeNull();
  });

  it("lists codes over the Gmail API without extra fields", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlText = String(url);
      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token" });
      }
      if (urlText.includes("/messages?")) {
        return jsonResponse({ messages: [{ id: "message-9" }] });
      }
      return jsonResponse({
        id: "message-9",
        payload: {
          headers: [
            { name: "From", value: "Steam <noreply@steampowered.com>" },
            { name: "Subject", value: "Steam Guard" },
          ],
          mimeType: "text/plain",
          body: {
            data: base64Url(
              "Here's the Steam Guard code you need to login to account XardGames1:\nDN356",
            ),
          },
        },
      });
    }) as unknown as typeof fetch;

    const entries = await listSteamCodes({ fetchImpl, gmailConfig: baseConfig });

    expect(entries).toHaveLength(1);
    expect(entries[0].account).toBe("XardGames1");
    expect(entries[0].code).toBe("DN356");
  });

  it("finds the latest Steam Guard code for one account", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const urlText = String(url);
      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token" });
      }
      if (urlText.includes("/messages?")) {
        const query = new URL(urlText).searchParams.get("q") ?? "";
        expect(query).toContain('"xardgames1"');
        return jsonResponse({ messages: [{ id: "older" }, { id: "latest" }, { id: "other" }] });
      }
      if (urlText.includes("/messages/older?")) {
        return jsonResponse(steamCodeMessage("older", "XardGames1", "AB234", "1760000000000"));
      }
      if (urlText.includes("/messages/latest?")) {
        return jsonResponse(steamCodeMessage("latest", "XardGames1", "CD345", "1760000060000"));
      }
      if (urlText.includes("/messages/other?")) {
        return jsonResponse(steamCodeMessage("other", "XardGames2", "EF456", "1760000120000"));
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    }) as unknown as typeof fetch;

    const entry = await findLatestSteamCodeForAccount("xardgames1", {
      fetchImpl,
      gmailConfig: baseConfig,
    });

    expect(formatSteamCodeLine(entry!)).toBe("XardGames1: CD345");
  });

  it("fails closed when Gmail is disabled or OAuth config is missing", async () => {
    await expect(listSteamMail({ gmailConfig: { ...baseConfig, enabled: false } }))
      .rejects.toThrow(GmailSteamMailError);

    await expect(listSteamMail({ gmailConfig: { ...baseConfig, refreshToken: undefined } }))
      .rejects.toThrow("GMAIL_REFRESH_TOKEN");
  });
});

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function steamCodeMessage(id: string, account: string, code: string, internalDate: string) {
  return {
    id,
    internalDate,
    payload: {
      headers: [
        { name: "From", value: "Steam <noreply@steampowered.com>" },
        { name: "Subject", value: "Steam Guard" },
      ],
      mimeType: "text/plain",
      body: {
        data: base64Url(
          `Here's the Steam Guard code you need to login to account ${account}:\n${code}`,
        ),
      },
    },
  };
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
