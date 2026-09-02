import { beforeEach, describe, expect, it, vi } from "vitest";

const { limit, dbMock } = vi.hoisted(() => {
  const limit = vi.fn();
  const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit };
  return { limit, dbMock: { select: vi.fn(() => chain) } };
});
vi.mock("../src/modules/database/db", () => ({ db: dbMock }));
import { buildOcrCacheKey, getCachedOcrResult } from "../src/modules/code-access/ocr";

const result = { order: null, device: { deviceName: "PC", motherboard: null, processor: null, installedRam: null, graphicsCard: null, storage: null, deviceId: "D", productId: null, systemType: null, osEdition: "Windows 11", osVersion: "25H2", osBuild: null, installedOn: null }, capturedAt: null, fullScreenVisible: true, steamLoginPromptVisible: true, confidence: 0.9, flags: [] };

describe("OCR cache", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses image hashes and prompt version as a stable key", () => {
    expect(buildOcrCacheKey(["a", "b"])).toBe(buildOcrCacheKey(["a", "b"]));
    expect(buildOcrCacheKey(["b", "a"])).not.toBe(buildOcrCacheKey(["a", "b"]));
  });
  it("returns a hit within seven days", async () => {
    limit.mockResolvedValue([{ resultJson: result, createdAt: new Date("2026-09-01T00:00:00Z") }]);
    await expect(getCachedOcrResult("k", new Date("2026-09-02T00:00:00Z"))).resolves.toMatchObject({ confidence: 0.9 });
  });
  it("returns a miss for absent or expired rows", async () => {
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ resultJson: result, createdAt: new Date("2026-08-01T00:00:00Z") }]);
    await expect(getCachedOcrResult("none", new Date("2026-09-02T00:00:00Z"))).resolves.toBeNull();
    await expect(getCachedOcrResult("old", new Date("2026-09-02T00:00:00Z"))).resolves.toBeNull();
  });
});
