import { config } from "@config";

/**
 * Steam account identity helpers.
 *
 * These live in shared/ because two domains need them and neither should
 * depend on the other: code-access owns the entitlement rules, while the gmail
 * reader only needs to recognise an account name inside mail text.
 */

const DEFAULT_ALLOWED_ACCOUNTS = [
  "XardGames1",
  "XardGames2",
  "XardGames3",
  "XardGames4",
  "XardGames5",
];

export function allowedCodeAccessAccounts(): string[] {
  const parsed = (config.CODE_ACCESS_ALLOWED_ACCOUNTS ?? "")
    .split(",")
    .map((account) => account.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ACCOUNTS;
}

export function normalizeSteamUsername(input: string): string {
  const fromUrl = extractSteamIdentifier(input);
  return (fromUrl ?? input)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^@+/, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 128);
}

/** Maps normalized username -> the canonically cased name from config. */
export function allowedAccountMap(): Map<string, string> {
  return new Map(
    allowedCodeAccessAccounts().map((account) => [
      normalizeSteamUsername(account),
      account,
    ]),
  );
}

function extractSteamIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!url.hostname.toLocaleLowerCase("en-US").endsWith("steamcommunity.com")) return null;

    const [kind, identifier] = url.pathname.split("/").filter(Boolean);
    if ((kind === "id" || kind === "profiles") && identifier) {
      return decodeURIComponent(identifier);
    }
  } catch {
    // Plain username, not a URL.
  }

  return null;
}
