import type { CodeAccessEntitlementRow } from "../../database/schema";

export type CodeAccessDecision =
  | { ok: true; entitlement: CodeAccessEntitlementRow; message: string }
  | { ok: false; entitlement?: CodeAccessEntitlementRow; reason: string };

export type CodeAccessRequestedCapability =
  | "manual_code_access"
  | "gmail_access"
  | "two_factor_code"
  | "code_retrieval";

export const UNSUPPORTED_SECRET_CAPABILITIES = new Set<CodeAccessRequestedCapability>([
  "gmail_access",
  "two_factor_code",
  "code_retrieval",
]);
