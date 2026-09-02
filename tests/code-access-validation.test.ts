import { describe, expect, it } from "vitest";
import { evidenceFlags, explainEvidenceFlags, isFreshScreenshot } from "../src/modules/code-access/service";
import { parseOcrResult } from "../src/modules/code-access/ocr";

const baseOcr = {
  order: null,
  device: { deviceName: "DESKTOP-A", motherboard: "Z690", processor: "i5", installedRam: "32 GB", graphicsCard: "RTX", storage: "2 TB", deviceId: "DEV-1", productId: "PROD-1", systemType: "64-bit", osEdition: "Windows 11 Pro", osVersion: "25H2", osBuild: "26200", installedOn: "2026-02-20" },
  fullScreenVisible: true, steamLoginPromptVisible: true, confidence: 0.92, flags: [] as string[],
};

describe("isFreshScreenshot / evidenceFlags (regression: stale_shot on a genuinely fresh Vietnam screenshot)", () => {
  it("treats a Vietnam-local capturedAt (anchored to +07:00 by the OCR parser) as fresh against a UTC `now` a few minutes later", () => {
    // What the model actually returns for a screenshot taken at 17:43 Vietnam
    // time, with no offset — exactly the report's repro.
    const ocr = parseOcrResult(JSON.stringify({ ...baseOcr, capturedAt: "2026-09-02T17:43:00" }));
    expect(ocr?.capturedAt).toBe("2026-09-02T17:43:00+07:00");
    // "now" 10 minutes later, expressed the way server code always does: UTC.
    const now = new Date("2026-09-02T10:53:00.000Z"); // 17:53 Vietnam time
    expect(isFreshScreenshot(ocr!.capturedAt, now)).toBe(true);
    expect(evidenceFlags(ocr!, true, true, now)).not.toContain("stale_shot");
  });
  it("still flags stale_shot for an actually old capturedAt when checkFreshness is on (/code request)", () => {
    const ocr = parseOcrResult(JSON.stringify({ ...baseOcr, capturedAt: "2026-09-02T09:00:00" }));
    const now = new Date("2026-09-02T10:53:00.000Z");
    expect(evidenceFlags(ocr!, true, true, now)).toContain("stale_shot");
  });
  it("flags stale_shot when capturedAt is missing entirely", () => {
    expect(isFreshScreenshot(null)).toBe(false);
  });
  it("never flags stale_shot for signup (checkFreshness=false), no matter how old capturedAt is", () => {
    const ocr = parseOcrResult(JSON.stringify({ ...baseOcr, capturedAt: "2020-01-01T00:00:00" }));
    const now = new Date("2026-09-02T10:53:00.000Z");
    expect(evidenceFlags(ocr!, false, false, now)).not.toContain("stale_shot");
  });
});

describe("explainEvidenceFlags (regression: user saw raw codes like 'stale_shot' with no explanation)", () => {
  it("translates every known flag code into a Vietnamese sentence the user can act on", () => {
    const text = explainEvidenceFlags(["stale_shot", "cropped", "weak_fingerprint", "no_os_version", "no_steam_prompt", "no_clock", "edited", "unreadable"]);
    expect(text).not.toMatch(/\bstale_shot\b/);
    expect(text).not.toMatch(/\bweak_fingerprint\b/);
    expect(text.split("; ")).toHaveLength(8);
  });
  it("falls back to the raw code only for a genuinely unknown flag, never throws", () => {
    expect(explainEvidenceFlags(["some_future_flag"])).toBe("some_future_flag");
  });
  it("returns an empty string for no flags", () => {
    expect(explainEvidenceFlags([])).toBe("");
  });
});
