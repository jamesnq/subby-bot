import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), mail: vi.fn() }));
vi.mock("../src/infrastructure/database/pool", () => ({ pool: { query: m.query } }));
vi.mock("../src/modules/gmail/steam-mail", () => ({ findLatestSteamCodeForAccount: m.mail }));
import { config } from "../src/config";
import { handleCodeInteraction } from "../src/modules/discord/commands/code";
import { handleCodeAdminInteraction } from "../src/modules/discord/commands/code-admin";
import { CODE_ADMIN_ID } from "../src/modules/code-access/reseller-whitelist";
const interaction = (id: string, commandName = "code_admin", values: Record<string,string> = { account: "XardGames4" }) => ({
  commandName, user: { id }, options: { getString: (key: string) => values[key] },
  deferReply: vi.fn(), editReply: vi.fn(),
}) as any;
describe("reseller and admin authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); m.query.mockResolvedValue({ rows: [] }); });
  it("denies non-whitelisted users before reading mail or creating orders", async () => {
    const i = interaction("other", "code_reseller");
    await handleCodeInteraction(i);
    expect(m.mail).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(i.editReply).toHaveBeenCalledWith(expect.stringContaining("chưa được cấp quyền"));
  });
  it.each(["code_admin", "code_whitelist"])("denies non-owner %s", async name => {
    await handleCodeAdminInteraction(interaction("other", name));
    expect(m.query).not.toHaveBeenCalled(); expect(m.mail).not.toHaveBeenCalled();
  });
  it("owner can read Gmail while the feature switch is off, without changing it", async () => {
    const original = config.GMAIL_ENABLED; config.GMAIL_ENABLED = false;
    try {
      m.mail.mockResolvedValue(null);
      await handleCodeAdminInteraction(interaction(CODE_ADMIN_ID));
      expect(m.mail).toHaveBeenCalledWith("XardGames4", expect.objectContaining({ gmailConfig: expect.objectContaining({ enabled: true }) }));
      expect(config.GMAIL_ENABLED).toBe(false); expect(m.query).not.toHaveBeenCalled();
    } finally { config.GMAIL_ENABLED = original; }
  });
  it.each(["add", "remove"])("owner can %s a whitelist ID", async action => {
    await handleCodeAdminInteraction(interaction(CODE_ADMIN_ID, "code_whitelist", { action, user_id: "123456789012345678" }));
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining(action === "add" ? "INSERT INTO" : "DELETE FROM"), ["123456789012345678"]);
  });
  it("rejects invalid whitelist IDs", async () => {
    await handleCodeAdminInteraction(interaction(CODE_ADMIN_ID, "code_whitelist", { action: "add", user_id: "bad" }));
    expect(m.query).not.toHaveBeenCalled();
  });
});
