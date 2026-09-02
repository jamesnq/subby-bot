import { beforeEach, describe, expect, it, vi } from "vitest";

const { policy, updateWhere, writeAudit } = vi.hoisted(() => ({
  policy: { CODE_ACCESS_OS_POLICY: "warn" },
  updateWhere: vi.fn().mockResolvedValue(undefined),
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@config", () => ({ config: policy }));
vi.mock("../src/modules/database/audit", () => ({ writeAudit }));
vi.mock("../src/modules/database/db", () => ({ db: { update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })) } }));
import { enforceOsPolicy, hasOsVersionMismatch } from "../src/modules/code-access/service/os-policy";

const slot = { id: "s1", guildId: "g1", userId: "u1" } as never;
const device = { osVersionLocked: "25H2" } as never;

describe("Windows version lock", () => {
  beforeEach(() => { vi.clearAllMocks(); policy.CODE_ACCESS_OS_POLICY = "warn"; });
  it("ignores build-only changes", () => expect(hasOsVersionMismatch("25H2", "25H2")).toBe(false));
  it("warn policy logs but allows a version mismatch", async () => {
    await expect(enforceOsPolicy({ slot, device, currentOsVersion: "26H1", confidence: 0.95 })).resolves.toMatchObject({ ok: true, warned: true });
    expect(writeAudit).toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
  });
  it("suspend policy blocks and updates the slot", async () => {
    policy.CODE_ACCESS_OS_POLICY = "suspend";
    await expect(enforceOsPolicy({ slot, device, currentOsVersion: "26H1", confidence: 0.95 })).resolves.toMatchObject({ ok: false, suspended: true });
    expect(updateWhere).toHaveBeenCalled();
  });
});
