import { describe, expect, it } from "vitest";
import { escalationExpiry, isEscalationExpired } from "../src/modules/code-access/escalations";
import { decideConfidence } from "../src/modules/code-access/service";

describe("code access escalation", () => {
  it("expires after 48 hours", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const expiry = escalationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(48 * 60 * 60_000);
    expect(isEscalationExpired(expiry, expiry)).toBe(true);
  });
  it("routes low confidence and fraud to an admin", () => {
    expect(decideConfidence(0.5)).toBe("escalate");
    expect(decideConfidence(1, ["device_shared"])).toBe("escalate");
  });
});
