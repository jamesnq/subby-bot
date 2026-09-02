import { describe, expect, it, vi } from "vitest";
import { parseCodeAccessCustomId } from "../src/modules/discord/commands/code-access";

const { getDraft } = vi.hoisted(() => ({ getDraft: vi.fn() }));
vi.mock("../src/modules/code-access/drafts", async (original) => ({ ...(await original()), getCodeAccessDraft: getDraft }));
import { ownedDraft } from "../src/modules/discord/commands/code-access/interaction-utils";

describe("code access interaction routing", () => {
  it("parses button, select, modal and evidence IDs", () => {
    expect(parseCodeAccessCustomId("ca:sg:ok:draft-1")).toEqual({ area: "sg", action: "ok", id: "draft-1", extra: undefined });
    expect(parseCodeAccessCustomId("ca:sg:modal:draft-1:os_version")?.extra).toBe("os_version");
    expect(parseCodeAccessCustomId("ca:es:img:esc-1:1")?.extra).toBe("1");
    expect(parseCodeAccessCustomId("wrong:id")).toBeNull();
  });
  it("prevents another user from taking over a draft", async () => {
    getDraft.mockResolvedValue({ id: "d1", kind: "signup", userId: "owner", guildId: "g1", expiresAt: new Date(Date.now() + 1_000) });
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = { user: { id: "attacker" }, guildId: "g1", deferred: false, replied: false, reply };
    await expect(ownedDraft(interaction as never, "d1", "signup")).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Chỉ người tạo") }));
  });
});
