import { describe, expect, it } from "vitest";
import { fingerprintDevice, matchDeviceFingerprint } from "../src/modules/code-access/service";
import type { WindowsDeviceInfo } from "../src/modules/code-access/ocr";

const device = (overrides: Partial<WindowsDeviceInfo> = {}): WindowsDeviceInfo => ({
  deviceName: "DESKTOP-A", motherboard: "Z690", processor: "i5-13600K", installedRam: "32 GB",
  graphicsCard: "RTX 3060", storage: "2 TB", deviceId: "DEV-123", productId: "PROD-123",
  systemType: "64-bit", osEdition: "Windows 11 Pro", osVersion: "25H2", osBuild: "26200.1", installedOn: "2026-02-20", ...overrides,
});

describe("device fingerprint", () => {
  it("uses Device ID as the primary identity", () => expect(fingerprintDevice(device({ motherboard: "different" })).hash).toBe(fingerprintDevice(device()).hash));
  it("allows RAM, storage, GPU, and build changes", () => expect(matchDeviceFingerprint(device(), device({ installedRam: "64 GB", storage: "4 TB", graphicsCard: "RTX 5090", osBuild: "26200.999" })).matches).toBe(true));
  it("falls back to at least three matching tier-2 fields when Device ID is unreadable", () => expect(matchDeviceFingerprint(device({ deviceId: null }), device({ deviceId: null, productId: "PROD-123", deviceName: "DESKTOP-A", motherboard: "Z690", processor: "i5-13600K" }))).toMatchObject({ matches: true, method: "tier_2", tier2Matches: 4 }));
  it("rejects a changed motherboard with too few other comparable matches", () => expect(matchDeviceFingerprint(device({ deviceId: null, productId: null }), device({ deviceId: null, productId: null, motherboard: "X999", processor: null }))).toMatchObject({ matches: false }));
});
