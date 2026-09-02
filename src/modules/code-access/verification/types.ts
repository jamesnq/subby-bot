export type DeviceFingerprint = {
  deviceName: string | null;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  serialNumber: string | null;
  imei: string | null;
  meid: string | null;
  androidId: string | null;
  udid: string | null;
  hardwareId: string | null;
  rawVisibleIdentifiers: string[];
};

export type CodeAccessVerificationResult = {
  fullScreenVisible: boolean;
  dateTimeVisible: boolean;
  purchaseLooksValid: boolean;
  durationMonths: number | null;
  purchaseDate: string | null;
  expiresAt: string | null;
  deviceFingerprint: DeviceFingerprint;
  deviceFingerprintLabel: string | null;
  deviceFingerprintParts: string[];
  confidence: number;
  reasons: string[];
};

export type VisionVerificationRequest = {
  systemPrompt: string;
  userPrompt: string;
  imageUrls: string[];
};

export type CodeAccessVerificationOptions = {
  guildId?: string;
  now?: Date;
  invokeVision?: (request: VisionVerificationRequest) => Promise<unknown>;
};

export const EMPTY_DEVICE_FINGERPRINT: DeviceFingerprint = {
  deviceName: null,
  platform: null,
  model: null,
  osVersion: null,
  serialNumber: null,
  imei: null,
  meid: null,
  androidId: null,
  udid: null,
  hardwareId: null,
  rawVisibleIdentifiers: [],
};

export type VisionVerificationFields = Omit<
  CodeAccessVerificationResult,
  "deviceFingerprintLabel" | "deviceFingerprintParts"
>;
