import { describe, expect, it } from "vitest";
import { checkPlanPolicy } from "../src/policies/policy";
import type { PlannedCall } from "../src/policies/types";
import type { RiskLevel } from "../src/tools/registry";

const known: Record<string, { risk: RiskLevel }> = {
  send_message: { risk: "write" },
  schedule_message: { risk: "write" },
  get_channel: { risk: "read" },
};
const lookup = (name: string) => known[name];
const limits = { maxCalls: 10, maxResources: 5 };

const msg = (content: string): PlannedCall => ({ name: "send_message", args: { content } });

describe("policy spam boundary", () => {
  it("allows exactly 3 duplicate messages", () => {
    const r = checkPlanPolicy([msg("hello"), msg("hello"), msg("hello")], limits, lookup);
    expect(r.ok).toBe(true);
  });

  it("blocks the 4th duplicate", () => {
    const calls = [msg("hello"), msg("hello"), msg("hello"), msg("hello")];
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(!r.ok && r.prohibited).toBe(true);
  });

  it("counts schedule_message toward spam duplicates", () => {
    const sched = (c: string): PlannedCall => ({ name: "schedule_message", args: { content: c, inMinutes: 5 } });
    const r = checkPlanPolicy([sched("x"), sched("x"), sched("x"), sched("x")], limits, lookup);
    expect(!r.ok && r.prohibited).toBe(true);
  });

  it("accepts call without args (schema default)", () => {
    const r = checkPlanPolicy([{ name: "get_channel" } as PlannedCall], limits, lookup);
    expect(r.ok).toBe(true);
  });
});
