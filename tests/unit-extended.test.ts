import { afterEach, describe, expect, it, vi } from "vitest";
import { hitRateLimit, resetRateLimits } from "../src/modules/policies/rate-limit";
import { evaluateBudget } from "../src/modules/agent/usage";
import { queryHashOf, roleScopeHash } from "../src/modules/knowledge/cache";
import { formatActionSummary } from "../src/modules/agent/nodes/compose-response";
import type { AgentState } from "../src/modules/agent/state";

describe("rate-limit window expiry", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetRateLimits();
  });

  it("entries expire after the 60s window", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) expect(hitRateLimit("u", 3)).toBe(true);
    expect(hitRateLimit("u", 3)).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(hitRateLimit("u", 3)).toBe(true);
  });
});

describe("evaluateBudget pure math", () => {
  const limits = { calls: 10, tokens: 1000 };

  it("null row allows", () => {
    expect(evaluateBudget(null, limits)).toEqual({ ok: true });
  });

  it("blocks at call boundary (>=)", () => {
    expect(evaluateBudget({ llmCalls: 10, promptTokens: 0, completionTokens: 0 }, limits).ok).toBe(false);
    expect(evaluateBudget({ llmCalls: 9, promptTokens: 0, completionTokens: 0 }, limits).ok).toBe(true);
  });

  it("blocks when token sum reaches limit", () => {
    const r = evaluateBudget({ llmCalls: 1, promptTokens: 600, completionTokens: 400 }, limits);
    expect(r.ok).toBe(false);
  });

  it("clamps negative tokens to zero before summing", () => {
    const r = evaluateBudget({ llmCalls: 1, promptTokens: -500, completionTokens: -500 }, limits);
    expect(r.ok).toBe(true);
  });
});

describe("cache key normalization", () => {
  it("queryHashOf normalizes case + whitespace", () => {
    expect(queryHashOf("  Giá   BAO NHIÊU ")).toBe(queryHashOf("giá bao nhiêu"));
  });

  it("distinct questions produce distinct hashes", () => {
    expect(queryHashOf("a")).not.toBe(queryHashOf("b"));
  });

  it("roleScopeHash is order-insensitive and stable for empty", () => {
    expect(roleScopeHash(["a", "b"])).toBe(roleScopeHash(["b", "a"]));
    expect(roleScopeHash([])).toBe(roleScopeHash([]));
    expect(roleScopeHash([])).not.toBe("");
  });
});

describe("formatActionSummary", () => {
  const base = {
    requestId: "r",
    guildId: "g",
    channelId: "c",
    userId: "u",
    input: "",
    proposedCalls: [
      { name: "create_channel", args: {} },
      { name: "send_message", args: {} },
      { name: "send_embed", args: {} },
    ],
  } as unknown as AgentState;

  it("stops listing after first failure and lists skipped steps", () => {
    const summary = formatActionSummary({
      ...base,
      toolResults: [
        { index: 0, toolName: "create_channel", risk: "write", status: "success", summary: "Đã tạo #a" },
        { index: 1, toolName: "send_message", risk: "write", status: "failed", summary: "", error: "boom" },
        { index: 2, toolName: "send_embed", risk: "write", status: "success", summary: "đã gửi" },
      ],
    });
    expect(summary).toContain("✅ Đã tạo #a");
    expect(summary).toContain("❌ Bước 2");
    expect(summary).not.toContain("đã gửi");
    expect(summary).toContain("send_embed");
    expect(summary).toContain("👉");
  });

  it("counts skipped_idempotent as success", () => {
    const summary = formatActionSummary({
      ...base,
      proposedCalls: [{ name: "get_channel", args: {} }],
      toolResults: [
        { index: 0, toolName: "get_channel", risk: "read", status: "skipped_idempotent", summary: "cached result" },
      ],
    });
    expect(summary).toContain("✅ Hoàn tất 1 bước");
    expect(summary).toContain("cached result");
  });

  it("empty results message", () => {
    expect(formatActionSummary({ ...base, toolResults: [] })).toBe("Không có bước nào được thực hiện.");
  });
});
