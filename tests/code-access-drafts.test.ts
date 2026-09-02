import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { codeAccessDraftExpiry, isCodeAccessDraftActive } from "../src/modules/code-access/drafts";
import { codeAccessDrafts } from "../src/modules/database/schema";

describe("code access drafts", () => {
  it("expires after 15 minutes", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const expiry = codeAccessDraftExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(15 * 60_000);
    expect(isCodeAccessDraftActive(expiry, new Date("2026-09-02T00:14:59Z"))).toBe(true);
    expect(isCodeAccessDraftActive(expiry, expiry)).toBe(false);
  });
  it("enforces one draft per guild/user/kind", () => {
    const names = getTableConfig(codeAccessDrafts).indexes.map((index) => index.config.name);
    expect(names).toContain("code_access_drafts_user_kind_idx");
  });
});
