export type CodeAccessBlockReason = "mfa_code_request" | "credential_distribution";

export type CodeAccessSafetyResult =
  | { blocked: false; reasons: [] }
  | { blocked: true; reasons: CodeAccessBlockReason[] };

export type CodeAccessReplyOptions = {
  content: string;
  allowedMentions: { parse: [] };
};

const MFA_OR_CODE_PATTERNS = [
  /\b(?:get|grab|fetch|retrieve|read|open|check|extract|intercept|bypass|use|enter|submit|send|share|forward|give|post|paste|dm)\s+(?:me\s+)?(?:the\s+)?(?:mfa|2fa|otp|one[-\s]?time\s+(?:pass(?:word|code)|code|pin)|(?:verification|login|security|authentication|auth|backup|recovery)\s+(?:code|pin|passcode))\b/i,
  /\b(?:get|grab|fetch|retrieve|read|open|check|extract|intercept|bypass|use|enter|submit|send|share|forward|give|post|paste|dm)\s+(?:me\s+)?(?:the\s+)?(?:gmail|email|sms|discord)\s+(?:code|verification|otp|login)\b/i,
  /\b(?:mfa|2fa|otp|one[-\s]?time\s+(?:pass(?:word|code)|code|pin)|(?:verification|login|security|authentication|auth|backup|recovery)\s+(?:code|pin|passcode))\s*(?::|=)\s*[A-Za-z0-9-]{4,12}\b/i,
  /\b(?:gmail|email|sms|discord)\s+(?:code|verification|otp|login)\s*(?::|=)\s*[A-Za-z0-9-]{4,12}\b/i,
  /\b(?:code|pin)\s+(?:from|sent\s+to|in)\s+(?:gmail|email|sms|text|discord)\b/i,
  /\b(?:send|share|forward|give|post|paste|dm)\s+(?:me\s+)?(?:the\s+)?(?:code|otp|mfa|2fa|pin)\b/i,
  /\bm[aã]\s+(?:otp|2fa|mfa|x[aá]c\s+minh|[dđ][aă]ng\s+nh[aậ]p|b[aả]o\s+m[aậ]t|kh[oô]i\s+ph[uụ]c)\b/i,
  /\b(?:g[uử]i|chia\s+s[eẻ]|nh[aậ]p|l[aấ]y)\s+(?:m[aã]\s+)?(?:otp|2fa|mfa|code|x[aá]c\s+minh|[dđ][aă]ng\s+nh[aậ]p)\b/i,
];

const CREDENTIAL_DISTRIBUTION_PATTERNS = [
  /\b(?:send|share|forward|give|post|paste|dm|show|print|expose|leak|use|enter|submit)\s+(?:me\s+)?(?:the\s+)?(?:(?:api|access|refresh|bearer|discord|github|google|oauth)\s+token|(?:api|secret|private|client)\s+key|session\s+(?:cookie|token|id)|auth(?:orization)?\s+header|password|passwd|passphrase|passcode|credential|login\s+details?|cookie|secret|seed\s+phrase|recovery\s+phrase)\b/i,
  /\b(?:password|passwd|passphrase|passcode|credential|token|api[_\s-]?key|secret|private[_\s-]?key|client[_\s-]?secret|cookie|authorization)\s*[:=]\s*["']?[^"'\s,;]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:g[uử]i|chia\s+s[eẻ]|[dđ][uư]a|d[aá]n|nh[aậ]p|hi[eể]n\s+th[iị])\s+(?:m[aậ]t\s+kh[aẩ]u|th[oô]ng\s+tin\s+[dđ][aă]ng\s+nh[aậ]p|token|kh[oóa]\s+(?:api|b[ií]\s+m[aậ]t|ri[eê]ng)|cookie|credential)\b/i,
  /\b(?:m[aậ]t\s+kh[aẩ]u|token|kh[oóa]\s+(?:api|b[ií]\s+m[aậ]t|ri[eê]ng)|cookie)\s*[:=]\s*["']?[^"'\s,;]+/i,
];

const SAFETY_EDUCATION_PATTERNS = [
  /\b(?:remind|tell|warn|educate|teach|advise)\s+(?:users|people|members|staff)?\s*(?:not\s+to|never\s+to|to\s+never|that\s+they\s+should\s+not)\s+(?:send|share|forward|give|post|paste|dm|expose)\b/i,
  /\b(?:do\s+not|don't|never|avoid)\s+(?:send|share|forward|give|post|paste|dm|exposing)\b/i,
  /\b(?:nh[aắ]c|c[aả]nh\s+b[aá]o|d[aặ]n)\s+(?:ng[uư][oờ]i\s+d[uù]ng|th[aà]nh\s+vi[eê]n)?\s*(?:kh[oô]ng|[dđ][uư]ng)\s+(?:g[uử]i|chia\s+s[eẻ]|[dđ][uư]a|d[aá]n)\b/i,
];

const EXPLICIT_SECRET_VALUE_PATTERN =
  /\b(?:password|passwd|passphrase|passcode|credential|token|api[_\s-]?key|secret|private[_\s-]?key|client[_\s-]?secret|cookie|authorization|otp|mfa|2fa|verification[_\s-]?code|login[_\s-]?code)\s*[:=]\s*["']?[^"'\s,;]+|\b\d{6}\b/i;

const SECRET_KEY_PATTERN =
  /(?:password|passwd|passphrase|passcode|credential|token|api[_\s-]?key|secret|private[_\s-]?key|client[_\s-]?secret|cookie|session|authorization|otp|mfa|2fa|verification[_\s-]?code|recovery[_\s-]?code|backup[_\s-]?code|login[_\s-]?code)/i;

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bmfa\.[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:password|passwd|passphrase|passcode|token|api[_\s-]?key|secret|cookie|authorization|otp|mfa|2fa|verification[_\s-]?code|login[_\s-]?code)\s*[:=]\s*["']?[^"'\s,;]+/gi,
  /\b(?:otp|mfa|2fa|verification|login|security|auth|backup|recovery)\s+(?:code|pin|passcode)\s*[:=]?\s*[A-Za-z0-9-]{4,12}\b/gi,
  /\b\d{6}\b/g,
];

const REDACTED = "[redacted]";
const BLOCKED_TEXT = "[blocked-code-access-text]";

export const CODE_ACCESS_ALLOWED_MENTIONS = { parse: [] } as const;

export const CODE_ACCESS_SAFE_RESPONSE =
  "I can't help retrieve, share, or relay login codes, MFA/2FA codes, passwords, tokens, cookies, or other credentials. Use the service's official sign-in, recovery, or admin flow instead.";

export function checkCodeAccessSafety(text: string): CodeAccessSafetyResult {
  if (isBenignSafetyEducation(text)) {
    return { blocked: false, reasons: [] };
  }

  const reasons: CodeAccessBlockReason[] = [];

  if (MFA_OR_CODE_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push("mfa_code_request");
  }

  if (CREDENTIAL_DISTRIBUTION_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push("credential_distribution");
  }

  return reasons.length > 0 ? { blocked: true, reasons } : { blocked: false, reasons: [] };
}

export function blocksCodeAccessText(text: string): boolean {
  return checkCodeAccessSafety(text).blocked;
}

export function safeCodeAccessResponse(): string {
  return CODE_ACCESS_SAFE_RESPONSE;
}

export function codeAccessSafeReply(content = CODE_ACCESS_SAFE_RESPONSE): CodeAccessReplyOptions {
  return {
    content,
    allowedMentions: { parse: [] },
  };
}

export function redactCodeAccessLogValue(value: unknown): unknown {
  return redactUnknown(value, 0);
}

export function codeAccessLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactUnknown(fields, 0) as Record<string, unknown>;
}

function redactUnknown(value: unknown, depth: number): unknown {
  if (depth > 8) return "[max-depth]";

  if (typeof value === "string") {
    return redactStringForLogs(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : redactUnknown(nestedValue, depth + 1);
    }
    return redacted;
  }

  return value;
}

function redactStringForLogs(value: string): string {
  if (blocksCodeAccessText(value)) return BLOCKED_TEXT;

  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

function isBenignSafetyEducation(text: string): boolean {
  return (
    SAFETY_EDUCATION_PATTERNS.some((pattern) => pattern.test(text)) &&
    !EXPLICIT_SECRET_VALUE_PATTERN.test(text)
  );
}
