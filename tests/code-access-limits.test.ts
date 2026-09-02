import { beforeEach, describe, expect, it } from "vitest";
import { hitCodeAccessDailyLimit, resetCodeAccessLimits } from "../src/modules/code-access/limits";

describe("code access daily limits", () => {
  beforeEach(() => resetCodeAccessLimits());

  it("limits per user and resets on a new UTC day", () => {
    const base = {
      guildId: "g1",
      userId: "u1",
      userLimit: 2,
      guildLimit: 10,
      now: new Date("2026-08-23T00:00:00.000Z"),
    };

    expect(hitCodeAccessDailyLimit(base).ok).toBe(true);
    expect(hitCodeAccessDailyLimit(base).ok).toBe(true);
    expect(hitCodeAccessDailyLimit(base).ok).toBe(false);
    expect(hitCodeAccessDailyLimit({ ...base, now: new Date("2026-08-24T00:00:00.000Z") }).ok).toBe(true);
  });

  it("limits per guild across users", () => {
    const now = new Date("2026-08-23T00:00:00.000Z");

    expect(hitCodeAccessDailyLimit({ guildId: "g1", userId: "u1", userLimit: 10, guildLimit: 2, now }).ok).toBe(true);
    expect(hitCodeAccessDailyLimit({ guildId: "g1", userId: "u2", userLimit: 10, guildLimit: 2, now }).ok).toBe(true);
    expect(hitCodeAccessDailyLimit({ guildId: "g1", userId: "u3", userLimit: 10, guildLimit: 2, now }).ok).toBe(false);
  });
});
