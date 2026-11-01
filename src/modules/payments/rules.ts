import type { PaymentLinkDataType } from "@payos/node/lib/type";
import type { SteamCodeEntry } from "../gmail/types";

export const CODE_PRICE_VND = 100_000;
export const BOT_ORDER_MIN = 8_000_000_000_000_000;
export function isVerifiedPayment(order: { order_code: string; amount: number; provider_link_id: string | null }, data: PaymentLinkDataType): boolean {
  return data.orderCode === Number(order.order_code) && data.amount === order.amount &&
    data.amountPaid >= order.amount && data.amountRemaining === 0 && data.status === "PAID" &&
    (!order.provider_link_id || data.id === order.provider_link_id);
}
export function isFreshCode(entry: SteamCodeEntry, maxMinutes: number, now = Date.now()): boolean {
  const received = Date.parse(entry.receivedAt ?? "");
  return /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/.test(entry.code) && !!entry.messageId && Number.isFinite(received) && received <= now + 60_000 && now - received <= maxMinutes * 60_000;
}
