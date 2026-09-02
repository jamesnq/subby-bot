import {
  allowedAccountMap,
  allowedCodeAccessAccounts,
  normalizeSteamUsername,
} from "@shared/steam-accounts";

export { allowedCodeAccessAccounts, normalizeSteamUsername };

export const CODE_ACCESS_ACCOUNT_NOT_FOUND = "Account does not exist.";

export function isAllowedCodeAccessAccount(input: string): boolean {
  const normalized = normalizeSteamUsername(input);
  if (!normalized) return false;

  return allowedAccountMap().has(normalized);
}

export function allowedCodeAccessAccountDisplay(input: string): string | undefined {
  const normalized = normalizeSteamUsername(input);
  if (!normalized) return undefined;

  return allowedAccountMap().get(normalized);
}
