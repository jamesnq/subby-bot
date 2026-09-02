import { config } from "@config";

export type ConfidenceDecision = "auto_approve" | "approve_with_audit" | "escalate";
export const FRAUD_FLAGS = ["duplicate_bill", "order_reused", "device_shared"] as const;
export type FraudFlag = typeof FRAUD_FLAGS[number];

export function decideConfidence(confidence: number, fraudFlags: FraudFlag[] = []): ConfidenceDecision {
  if (fraudFlags.length > 0 || confidence < config.CODE_ACCESS_ESCALATE_BELOW) return "escalate";
  if (confidence >= config.CODE_ACCESS_AUTO_APPROVE_ABOVE) return "auto_approve";
  return "approve_with_audit";
}
