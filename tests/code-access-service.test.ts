import { describe, expect, it } from "vitest";
import { calculateSubscription, decideConfidence, fraudFlagsFromMatches, isSubscriptionActive } from "../src/modules/code-access/service";

describe("code access domain", () => {
  it("supports lifetime subscriptions without an end date", () => {
    const result = calculateSubscription({ planKind: "lifetime", planUnits: null, orderPlacedAt: "2026-09-02T00:00:00Z" });
    expect(result.end).toBeNull();
    expect(isSubscriptionActive(result.end, new Date("2099-01-01"))).toBe(true);
  });
  it("supports N packages by not deriving identity from Discord user", () => {
    const month = calculateSubscription({ planKind: "month", planUnits: 2, orderPlacedAt: "2026-01-15T00:00:00Z" });
    const year = calculateSubscription({ planKind: "year", planUnits: 1, orderPlacedAt: "2026-01-15T00:00:00Z" });
    expect(month.end?.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(year.end?.toISOString().slice(0, 10)).toBe("2027-01-15");
  });
  it("always escalates deterministic fraud flags", () => {
    const flags = fraudFlagsFromMatches({ duplicateBill: true, reusedOrder: true, sharedDevice: true });
    expect(flags).toEqual(["duplicate_bill", "order_reused", "device_shared"]);
    expect(decideConfidence(0.99, flags)).toBe("escalate");
  });
  it("implements all three confidence zones", () => {
    expect(decideConfidence(0.95)).toBe("auto_approve");
    expect(decideConfidence(0.85)).toBe("approve_with_audit");
    expect(decideConfidence(0.79)).toBe("escalate");
  });
});
