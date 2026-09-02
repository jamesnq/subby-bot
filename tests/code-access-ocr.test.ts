import { describe, expect, it, vi } from "vitest";
import { analyzeCodeAccessImages, OCR_SYSTEM_PROMPT, parseOcrResult } from "../src/modules/code-access/ocr";

const valid = {
  order: { orderCode: "#2398", orderPlacedAt: "2026-09-02T13:51:00+07:00", orderSource: "web", orderTotalText: "99k", productName: "Steam Offline", planKind: "month", planUnits: 1 },
  device: { deviceName: "DESKTOP-A", motherboard: "Z690", processor: "i5", installedRam: "32 GB", graphicsCard: "RTX", storage: "2 TB", deviceId: "DEV-1", productId: "PROD-1", systemType: "64-bit", osEdition: "Windows 11 Pro", osVersion: "25H2", osBuild: "26200", installedOn: "2026-02-20" },
  capturedAt: "2026-09-02T14:00:00+07:00", fullScreenVisible: true, steamLoginPromptVisible: false, confidence: 0.92, flags: [],
};

describe("code access OCR parser", () => {
  it("parses valid JSON and trims strings", () => {
    const result = parseOcrResult(JSON.stringify({ ...valid, device: { ...valid.device, deviceName: "  DESKTOP-A  " } }));
    expect(result?.device.deviceName).toBe("DESKTOP-A");
  });
  it("accepts a JSON markdown fence defensively", () => expect(parseOcrResult(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``)?.order?.orderCode).toBe("#2398"));
  it("fills optional missing device fields with null", () => {
    const result = parseOcrResult(JSON.stringify({ ...valid, device: { deviceName: "PC" } }));
    expect(result?.device.deviceId).toBeNull();
  });
  it("returns null for garbage or a structurally invalid response", () => {
    expect(parseOcrResult("not json")).toBeNull();
    expect(parseOcrResult(JSON.stringify({ confidence: 0.9 }))).toBeNull();
  });
  it("sends both signup images in one call and treats image text as untrusted", async () => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify(valid));
    await analyzeCodeAccessImages({
      mode: "signup",
      images: [{ sha256: "a", dataUrl: "data:image/jpeg;base64,AA==" }, { sha256: "b", dataUrl: "data:image/jpeg;base64,BB==" }],
      invoke,
      readCache: vi.fn().mockResolvedValue(null),
      writeCache: vi.fn().mockResolvedValue(undefined),
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].imageDataUrls).toHaveLength(2);
    expect(OCR_SYSTEM_PROMPT).toContain("untrusted evidence");
  });
});
