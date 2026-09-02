import { describe, expect, it } from "vitest";
import { evidenceFlags, matchDeviceFingerprint } from "../src/modules/code-access/service";
import type { WindowsDeviceInfo } from "../src/modules/code-access/ocr";

const base: WindowsDeviceInfo = { deviceName: "PC-1", motherboard: "B760", processor: "i7", installedRam: "16GB", graphicsCard: "RTX", storage: "1TB", deviceId: "DEVICE-ONE", productId: "PRODUCT-ONE", systemType: "64-bit", osEdition: "Windows 11", osVersion: "25H2", osBuild: "1", installedOn: null };

describe("code request device lookup", () => {
  it("matches the registered physical device independently of requested username", () => {
    const devices = [{ slot: "xardgames1", device: base }, { slot: "xardgames2", device: { ...base, deviceId: "DEVICE-TWO" } }];
    const found = devices.find((candidate) => matchDeviceFingerprint(candidate.device, { ...base, osBuild: "2", installedRam: "32GB" }).matches);
    expect(found?.slot).toBe("xardgames1");
  });
  it("requires a current full-screen Steam prompt before issuing", () => {
    const flags = evidenceFlags({
      order: null, device: base, capturedAt: "2026-09-02T00:00:00Z", fullScreenVisible: true,
      steamLoginPromptVisible: false, confidence: 0.95, flags: [],
    }, true, new Date("2026-09-02T00:05:00Z"));
    expect(flags).toContain("no_steam_prompt");
    expect(flags).not.toContain("stale_shot");
  });
});
