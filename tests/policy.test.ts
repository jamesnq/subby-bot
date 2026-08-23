import { describe, expect, it } from "vitest";
import { checkPlanPolicy } from "../src/policies/policy";
import type { PlannedCall } from "../src/policies/types";
import type { RiskLevel } from "../src/tools/registry";

const limits = { maxCalls: 10, maxResources: 5 };

const knownTools: Record<string, { risk: RiskLevel }> = {
  list_guild_structure: { risk: "read" },
  get_channel: { risk: "read" },
  create_channel: { risk: "write" },
  delete_channel: { risk: "destructive" },
  send_message: { risk: "write" },
};

const lookup = (name: string) => knownTools[name];

describe("checkPlanPolicy", () => {
  it("rejects empty plans", () => {
    const r = checkPlanPolicy([], limits, lookup);
    expect(r.ok).toBe(false);
  });

  it("accepts a valid read plan", () => {
    const calls: PlannedCall[] = [{ name: "list_guild_structure", args: {} }];
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(r).toEqual({ ok: true, risks: ["read"] });
  });

  it("rejects unknown tool names", () => {
    const calls: PlannedCall[] = [{ name: "nuke_everything", args: {} }];
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(!r.ok && r.reason.includes("nuke_everything")).toBe(true);
  });

  it("enforces max tool calls", () => {
    const calls: PlannedCall[] = Array.from({ length: 11 }, () => ({
      name: "get_channel",
      args: { channelRef: "general" },
    }));
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(!r.ok && r.prohibited).toBe(false);
  });

  it("enforces max resources created per plan", () => {
    const calls: PlannedCall[] = Array.from({ length: 6 }, (_, i) => ({
      name: "create_channel",
      args: { name: `channel-${i}` },
    }));
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(!r.ok && r.reason.includes("5")).toBe(true);
  });

  it("flags duplicate message spam as prohibited", () => {
    const calls: PlannedCall[] = Array.from({ length: 4 }, () => ({
      name: "send_message",
      args: { content: "mua key giá rẻ inbox em" },
    }));
    const r = checkPlanPolicy(calls, limits, lookup);
    expect(!r.ok && r.prohibited).toBe(true);
  });
});
