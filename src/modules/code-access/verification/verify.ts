import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getPlannerModel, invokeTracked } from "../../agent/llm";
import { logger } from "@shared/logger";
import { buildMultimodalContent } from "@shared/media";
import {
  EMPTY_DEVICE_FINGERPRINT,
  type CodeAccessVerificationOptions,
  type CodeAccessVerificationResult,
  type VisionVerificationFields,
  type VisionVerificationRequest,
} from "./types";
import { buildDeviceFingerprintParts, buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import {
  addMonths,
  clamp,
  firstNonNull,
  formatDate,
  normalizeDate,
  parseDateFromText,
  parseDurationMonths,
  parseExpiryDateFromText,
  parseVisionResult,
} from "./parsing";
export async function verifyCodeAccessScreenshots(
  purchaseProofImageUrls: string[],
  deviceInfoScreenshotUrls: string[],
  options: CodeAccessVerificationOptions = {},
): Promise<CodeAccessVerificationResult> {
  const purchaseUrls = normalizeImageUrls(purchaseProofImageUrls);
  const deviceUrls = normalizeImageUrls(deviceInfoScreenshotUrls);
  const allImageUrls = [...purchaseUrls, ...deviceUrls];
  const now = options.now ?? new Date();
  const fallback = deterministicVerificationFallback(purchaseUrls, deviceUrls, now);

  if (allImageUrls.length === 0) {
    return fallback;
  }

  const request: VisionVerificationRequest = {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(purchaseUrls.length, deviceUrls.length, now),
    imageUrls: allImageUrls,
  };

  try {
    const raw = options.invokeVision
      ? await options.invokeVision(request)
      : await invokeVisionWithPlanner(request, options.guildId ?? "code-access-verification");
    const parsed = parseVisionResult(raw);
    if (!parsed) {
      return {
        ...fallback,
        reasons: [
          ...fallback.reasons,
          "Vision verifier did not return valid structured JSON; used deterministic fallback.",
        ],
      };
    }

    return finalizeResult(parsed, now);
  } catch (err) {
    logger.warn({ err }, "code access vision verification failed; using deterministic fallback");
    return {
      ...fallback,
      reasons: [
        ...fallback.reasons,
        "Vision verifier failed; used deterministic fallback.",
      ],
    };
  }
}

export function deterministicVerificationFallback(
  purchaseProofImageUrls: string[],
  deviceInfoScreenshotUrls: string[],
  now: Date = new Date(),
): CodeAccessVerificationResult {
  const allUrls = [...purchaseProofImageUrls, ...deviceInfoScreenshotUrls];
  const validUrlCount = allUrls.filter(isHttpUrl).length;
  const parsedDuration = firstNonNull(allUrls.map(parseDurationMonths));
  const parsedPurchaseDate = firstNonNull(allUrls.map(parseDateFromText));
  const expiresAt =
    parsedPurchaseDate && parsedDuration
      ? addMonths(parsedPurchaseDate, parsedDuration)
      : firstNonNull(allUrls.map(parseExpiryDateFromText));

  const reasons: string[] = [];
  if (validUrlCount === 0) {
    reasons.push("No valid HTTP(S) screenshot URLs were provided.");
  } else {
    reasons.push("Deterministic fallback cannot inspect screenshot pixels.");
  }
  if (parsedPurchaseDate) {
    reasons.push("Purchase date was parsed from URL text only.");
  }
  if (parsedDuration) {
    reasons.push("Duration was parsed from URL text only.");
  }
  if (expiresAt) {
    reasons.push("Expiration date was derived from URL text only.");
  }

  return {
    fullScreenVisible: false,
    dateTimeVisible: false,
    purchaseLooksValid: false,
    durationMonths: parsedDuration,
    purchaseDate: parsedPurchaseDate,
    expiresAt,
    deviceFingerprint: EMPTY_DEVICE_FINGERPRINT,
    deviceFingerprintLabel: null,
    deviceFingerprintParts: [],
    confidence: validUrlCount > 0 ? 0.12 : 0,
    reasons,
  };
}

async function invokeVisionWithPlanner(
  request: VisionVerificationRequest,
  guildId: string,
): Promise<unknown> {
  const response = await invokeTracked(getPlannerModel(), guildId, [
    new SystemMessage(request.systemPrompt),
    new HumanMessage({
      content: buildMultimodalContent(request.userPrompt, request.imageUrls),
    }),
  ]);
  return response.content;
}

function finalizeResult(
  result: VisionVerificationFields,
  now: Date,
): CodeAccessVerificationResult {
  const purchaseDate = normalizeDate(result.purchaseDate);
  const durationMonths = result.durationMonths;
  const expiresAt =
    normalizeDate(result.expiresAt) ??
    (purchaseDate && durationMonths ? addMonths(purchaseDate, durationMonths) : null);
  const reasons = result.reasons
    .map((reason) => reason.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (expiresAt && expiresAt < formatDate(now)) {
    reasons.push("Access appears expired based on the visible or derived expiration date.");
  }

  const deviceFingerprint = {
    ...EMPTY_DEVICE_FINGERPRINT,
    ...result.deviceFingerprint,
    rawVisibleIdentifiers: result.deviceFingerprint.rawVisibleIdentifiers
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 20),
  };
  const deviceFingerprintParts = buildDeviceFingerprintParts(deviceFingerprint);

  return {
    fullScreenVisible: result.fullScreenVisible,
    dateTimeVisible: result.dateTimeVisible,
    purchaseLooksValid: result.purchaseLooksValid,
    durationMonths,
    purchaseDate,
    expiresAt,
    deviceFingerprint,
    deviceFingerprintLabel: deviceFingerprintParts[0] ?? null,
    deviceFingerprintParts,
    confidence: clamp(result.confidence, 0, 1),
    reasons: reasons.length > 0 ? reasons : ["Vision verifier returned structured evidence."],
  };
}

export function isHighConfidenceApproval(
  result: CodeAccessVerificationResult,
  now: Date = new Date(),
): boolean {
  if (!result.fullScreenVisible || !result.dateTimeVisible || !result.purchaseLooksValid) {
    return false;
  }
  if (result.confidence < 0.75) return false;
  if (!result.purchaseDate || !result.expiresAt || !result.durationMonths) return false;
  if (result.deviceFingerprintParts.length === 0) return false;

  const expiresAt = new Date(`${result.expiresAt}T23:59:59.999Z`);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

function normalizeImageUrls(urls: string[]): string[] {
  return [...new Set(urls.map((url) => url.trim()).filter(isHttpUrl))];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
