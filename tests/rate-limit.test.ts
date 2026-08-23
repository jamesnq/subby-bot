import { beforeEach, describe, expect, it } from "vitest";
import { hitRateLimit, resetRateLimits } from "../src/policies/rate-limit";

describe("hitRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests under the limit", () => {
    for (let i = 0; i < 10; i++) {
      expect(hitRateLimit("u1", 10)).toBe(true);
    }
  });

  it("blocks the request exceeding the limit", () => {
    for (let i = 0; i < 5; i++) hitRateLimit("u2", 5);
    expect(hitRateLimit("u2", 5)).toBe(false);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) hitRateLimit("a", 3);
    expect(hitRateLimit("a", 3)).toBe(false);
    expect(hitRateLimit("b", 3)).toBe(true);
  });
});
