// v5: capturedAt/orderPlacedAt now anchored to a UTC offset (see parsing.ts
// anchorToShopTimezone) — bumped to stop serving pre-fix cached OCR results
// whose offset-less timestamps were misread as stale on a UTC server.
export const OCR_PROMPT_VERSION = "code-access-v5";

export const OCR_FLAGS = [
  "cropped",
  "no_clock",
  "edited",
  "unreadable",
  "no_steam_prompt",
] as const;

export type OcrFlag = typeof OCR_FLAGS[number];
export type PlanKind = "month" | "year" | "lifetime";

export type WindowsDeviceInfo = {
  deviceName: string | null;
  motherboard: string | null;
  processor: string | null;
  installedRam: string | null;
  graphicsCard: string | null;
  storage: string | null;
  deviceId: string | null;
  productId: string | null;
  systemType: string | null;
  osEdition: string | null;
  osVersion: string | null;
  osBuild: string | null;
  installedOn: string | null;
};

export type PurchaseInfo = {
  orderCode: string | null;
  orderPlacedAt: string | null;
  orderSource: "web" | "messenger" | "other" | null;
  orderTotalText: string | null;
  productName: string | null;
  planKind: PlanKind | null;
  planUnits: number | null;
};

export type CodeAccessOcrResult = {
  order: PurchaseInfo | null;
  device: WindowsDeviceInfo;
  capturedAt: string | null;
  fullScreenVisible: boolean;
  steamLoginPromptVisible: boolean;
  confidence: number;
  flags: OcrFlag[];
};

export type OcrImage = { sha256: string; dataUrl: string };
export type OcrMode = "signup" | "request_pc" | "request_handheld";
