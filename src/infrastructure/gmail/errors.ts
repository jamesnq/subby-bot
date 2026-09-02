/**
 * Transport-level failure talking to Gmail: OAuth refresh, HTTP status, or a
 * malformed response body. Kept as one class because callers only ever need to
 * distinguish "Gmail did not answer" from a genuine bug.
 */
export class GmailSteamMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailSteamMailError";
  }
}
