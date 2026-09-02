import { beforeEach, describe, expect, it } from "vitest";
import { hitRateLimit, resetRateLimits } from "../src/modules/policies/rate-limit";

describe("hitRateLimit", () => {
  beforeEach(async () => {
    await resetRateLimits();
  });

  it("allows requests under the limit", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await hitRateLimit("u1", 10)).toBe(true);
    }
  });

  it("blocks the request exceeding the limit", async () => {
    for (let i = 0; i < 5; i++) await hitRateLimit("u2", 5);
    expect(await hitRateLimit("u2", 5)).toBe(false);
  });

  it("tracks keys independently", async () => {
    for (let i = 0; i < 3; i++) await hitRateLimit("a", 3);
    expect(await hitRateLimit("a", 3)).toBe(false);
    expect(await hitRateLimit("b", 3)).toBe(true);
  });
});
