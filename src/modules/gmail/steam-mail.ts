/**
 * Public surface of the Gmail/Steam module.
 *
 * The implementation is split across config/, text/, mail/ and steam-codes/,
 * with the HTTP transport in @infra/gmail. This barrel keeps a single import
 * path for callers so the internal layout can change without touching them.
 */
export { GmailSteamMailError } from "@infra/gmail/errors";

export { gmailConfigFromAppConfig } from "./config";
export { listSteamMail, parseSteamMailMessage } from "./mail";
export {
  extractSteamCode,
  findLatestSteamCodeForAccount,
  formatSteamCodeLine,
  listSteamCodes,
} from "./steam-codes";
export type {
  GmailSteamMailConfig,
  ListSteamMailOptions,
  SteamCodeEntry,
  SteamMailMessage,
} from "./types";
