import type { PlanKind } from "../ocr";

export function calculateSubscription(input: { planKind: PlanKind; planUnits: number | null; orderPlacedAt: string | null; now?: Date }): { start: Date; end: Date | null } {
  const fallback = input.now ?? new Date();
  const parsed = input.orderPlacedAt ? new Date(input.orderPlacedAt) : fallback;
  const start = Number.isFinite(parsed.getTime()) ? parsed : fallback;
  if (input.planKind === "lifetime") return { start, end: null };
  const units = Math.max(1, input.planUnits ?? 1);
  const end = new Date(start);
  if (input.planKind === "year") end.setUTCFullYear(end.getUTCFullYear() + units);
  else end.setUTCMonth(end.getUTCMonth() + units);
  return { start, end };
}

export function isSubscriptionActive(end: Date | null, now = new Date()): boolean {
  return end === null || end.getTime() > now.getTime();
}
