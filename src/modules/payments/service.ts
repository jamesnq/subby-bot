import { createHmac, randomInt } from "node:crypto";
import PayOS from "@payos/node";
import type { Client } from "discord.js";
import { pool } from "@infra/database/pool";
import { config } from "@config";
import { logger } from "@shared/logger";
import { findLatestSteamCodeForAccount } from "../gmail/steam-mail";
import type { SteamCodeEntry } from "../gmail/types";
import { BOT_ORDER_MIN, CODE_PRICE_VND, isFreshCode, isVerifiedPayment } from "./rules";

export type CodeOrder = {
  id: string; order_code: string; user_id: string; account: string; amount: number;
  status: "creating" | "pending" | "paid" | "fulfilled" | "cancelled" | "expired";
  checkout_url: string | null; provider_link_id: string | null; gmail_message_id: string | null;
  payment_details?: { qrCode: string; accountNumber: string; accountName: string; bin: string; description: string } | null;
  expires_at: Date; discord_message_id: string | null;
};
function provider(): PayOS {
  if (!config.PAYOS_CLIENT_KEY || !config.PAYOS_API_KEY || !config.PAYOS_CHECKSUM_KEY) throw new Error("PAYOS_NOT_CONFIGURED");
  return new PayOS(config.PAYOS_CLIENT_KEY, config.PAYOS_API_KEY, config.PAYOS_CHECKSUM_KEY);
}
function digest(account: string, code: string): string {
  if (!config.PAYOS_CHECKSUM_KEY) throw new Error("PAYOS_NOT_CONFIGURED");
  return createHmac("sha256", config.PAYOS_CHECKSUM_KEY).update(account.toLowerCase()+":"+code).digest("hex");
}
export async function alreadyPurchased(userId: string, account: string, messageId: string, code?: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM bot_code_orders WHERE user_id=$1 AND account=$2 AND (gmail_message_id=$3 OR code_digest=$4) AND status='fulfilled'", [userId, account, messageId, code ? digest(account,code) : null]);
  return result.rowCount === 1;
}
export async function getOrder(id: string, userId: string): Promise<CodeOrder | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return (await pool.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE id=$1 AND user_id=$2", [id, userId])).rows[0] ?? null;
}
export async function prepareOrder(userId: string, account: string): Promise<CodeOrder> {
  const conn = await pool.connect();
  let order: CodeOrder;
  try {
    await conn.query("BEGIN");
    await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`code:${userId}:${account}`]);
    const active = await conn.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE user_id=$1 AND account=$2 AND status IN ('creating','pending','paid') LIMIT 1", [userId, account]);
    if (active.rows[0]) order = active.rows[0];
    else {
      const number = BOT_ORDER_MIN + randomInt(0, 999_999_999_999);
      order = (await conn.query<CodeOrder>("INSERT INTO bot_code_orders(order_code,user_id,account,amount,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes') RETURNING *", [number, userId, account, CODE_PRICE_VND])).rows[0]!;
    }
    await conn.query("COMMIT");
  } catch (error) { await conn.query("ROLLBACK"); throw error; }
  finally { conn.release(); }
  if (order.status === "paid" || order.checkout_url) return order;
  // Serialize remote creation, retaining the same order code after a timeout.
  const locked = await pool.connect();
  try {
    await locked.query("BEGIN");
    order = (await locked.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE id=$1 FOR UPDATE", [order.id])).rows[0]!;
    if (order.checkout_url || order.status !== "creating") { await locked.query("COMMIT"); return order; }
    if (order.expires_at.getTime() <= Date.now()) {
      order = (await locked.query<CodeOrder>("UPDATE bot_code_orders SET expires_at=now()+interval '15 minutes' WHERE id=$1 RETURNING *",[order.id])).rows[0]!;
    }
    let data;
    try {
      data = await provider().createPaymentLink({
        orderCode: Number(order.order_code), amount: order.amount, description: `SGZBOT ${account}`.slice(0, 25),
        returnUrl: config.PAYOS_RETURN_URL, cancelUrl: config.PAYOS_CANCEL_URL,
        expiredAt: Math.floor(order.expires_at.getTime()/1000),
      });
    } catch (creationError) {
      // A timeout can happen after payOS has created the link. Recover that
      // exact signed order rather than reserving a second payment request.
      try {
        const existing = await provider().getPaymentLinkInformation(Number(order.order_code));
        if (existing.orderCode !== Number(order.order_code) || existing.amount !== order.amount) throw creationError;
        const recovered = (await locked.query<CodeOrder>("UPDATE bot_code_orders SET checkout_url=$2,provider_link_id=$3,status='pending' WHERE id=$1 RETURNING *",[order.id,`https://pay.payos.vn/web/${existing.id}`,existing.id])).rows[0]!;
        await locked.query("COMMIT");
        return recovered;
      } catch { throw creationError; }
    }
    if (data.orderCode !== Number(order.order_code) || data.amount !== order.amount || data.currency !== "VND" || !data.checkoutUrl.startsWith("https://")) throw new Error("PAYOS_LINK_MISMATCH");
    order = (await locked.query<CodeOrder>("UPDATE bot_code_orders SET checkout_url=$2,provider_link_id=$3,payment_details=$4,status=CASE WHEN status='creating' THEN 'pending' ELSE status END WHERE id=$1 RETURNING *", [order.id,data.checkoutUrl,data.paymentLinkId,JSON.stringify({qrCode:data.qrCode,accountNumber:data.accountNumber,accountName:data.accountName,bin:data.bin,description:data.description})])).rows[0]!;
    await locked.query("COMMIT");
    return order;
  } catch(error) { await locked.query("ROLLBACK"); throw error; }
  finally { locked.release(); }
}
/** Migrate legacy links without inventing bank details or transfer references. */
export async function ensureQrOrder(order: CodeOrder): Promise<CodeOrder> {
  if (order.status !== "pending" || order.payment_details?.qrCode) return order;
  const current = await reconcileOrder(order);
  if (current.status !== "pending") return current;
  const cancelled = await provider().cancelPaymentLink(Number(order.order_code), "Reissue as QR payment in Discord");
  if (isVerifiedPayment(current,cancelled)) return reconcileOrder(current);
  if (cancelled.status !== "CANCELLED" || cancelled.orderCode !== Number(order.order_code) || cancelled.id !== current.provider_link_id) throw new Error("PAYOS_CANCEL_NOT_CONFIRMED");
  await pool.query("UPDATE bot_code_orders SET status='cancelled' WHERE id=$1 AND status IN ('creating','pending')",[current.id]);
  return prepareOrder(current.user_id,current.account);
}
export async function reconcileOrder(order: CodeOrder): Promise<CodeOrder> {
  if (!["pending", "creating"].includes(order.status)) return order;
  // SDK validates the response signature with the merchant checksum key.
  const data = await provider().getPaymentLinkInformation(Number(order.order_code));
  const paid = isVerifiedPayment(order, data);
  if (data.status === "PAID" && !paid) throw new Error("PAYOS_PAYMENT_MISMATCH");
  const state = paid ? "paid" : data.status === "CANCELLED" ? "cancelled" : data.status === "EXPIRED" ? "expired" : order.status;
  return (await pool.query<CodeOrder>("UPDATE bot_code_orders SET status=$2,last_checked_at=now(),paid_at=CASE WHEN $2='paid' THEN coalesce(paid_at,now()) ELSE paid_at END,provider_link_id=coalesce(provider_link_id,$3),last_error=NULL WHERE id=$1 AND status IN ('pending','creating') RETURNING *", [order.id,state,data.id])).rows[0] ?? (await getOrder(order.id,order.user_id))!;
}
export type DeliveryOutcome = "fulfilled" | "waiting" | "done";
export async function deliverOrder(order: CodeOrder, send: (entry: SteamCodeEntry) => Promise<string>): Promise<DeliveryOutcome> {
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    const current = (await conn.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE id=$1 AND user_id=$2 FOR UPDATE", [order.id,order.user_id])).rows[0];
    if (!current || current.status !== "paid") { await conn.query("COMMIT"); return "done"; }
    const entry = await findLatestSteamCodeForAccount(current.account);
    if (!entry || entry.account.toLowerCase() !== current.account.toLowerCase() || !isFreshCode(entry,config.CODE_PAYMENT_MAX_CODE_AGE_MINUTES)) { await conn.query("COMMIT"); return "waiting"; }
    const previous = await conn.query("SELECT 1 FROM bot_code_orders WHERE user_id=$1 AND account=$2 AND (gmail_message_id=$3 OR code_digest=$4) AND status='fulfilled'", [current.user_id,current.account,entry.messageId,digest(current.account,entry.code)]);
    if (previous.rowCount) { await conn.query("COMMIT"); return "waiting"; }
    const messageId = await send(entry);
    await conn.query("UPDATE bot_code_orders SET status='fulfilled',gmail_message_id=$2,discord_message_id=$3,fulfilled_at=now(),last_error=NULL,code_digest=$4 WHERE id=$1", [current.id,entry.messageId,messageId,digest(current.account,entry.code)]);
    await conn.query("COMMIT");
    return "fulfilled";
  } catch(error) { await conn.query("ROLLBACK"); throw error; }
  finally { conn.release(); }
}
export function formatCode(entry: SteamCodeEntry, account: string): string {
  const received = new Date(entry.receivedAt ?? "");
  const time = Number.isFinite(received.getTime()) ? new Intl.DateTimeFormat("vi-VN", { timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit",year:"numeric",hour12:false }).format(received) : "";
  return [`🔐 **${account}**`, `Mã xác thực: \` ${entry.code} \``,time ? `Nhận email lúc ${time} (giờ Việt Nam)` : ""].filter(Boolean).join("\n");
}
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startPaymentPolling(client: Client): void {
  if (!config.CODE_PAYMENT_ENABLED) return;
  provider();
  const tick = async () => {
    if (running || !client.isReady()) return;
    running = true;
    try {
      const orders = await pool.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE status IN ('pending','paid','creating') ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 20");
      for (const order of orders.rows) {
        try {
          await pool.query("UPDATE bot_code_orders SET last_checked_at=now() WHERE id=$1",[order.id]);
          const current = await reconcileOrder(order.status === "creating" ? await prepareOrder(order.user_id,order.account) : order);
          if (current.status === "paid") await deliverOrder(current,async entry => {
            const user = await client.users.fetch(current.user_id);
            return (await user.send({ content: formatCode(entry,current.account),allowedMentions:{parse:[]} })).id;
          });
        } catch(error) {
          // Never log SDK request objects: they can contain payment credentials.
          await pool.query("UPDATE bot_code_orders SET last_error=$2 WHERE id=$1",[order.id,error instanceof Error ? error.name : "unknown"]);
          logger.warn({orderId:order.id,errorType:error instanceof Error ? error.name : "unknown"},"Payment check/delivery will retry");
        }
      }
    } catch { logger.warn("Payment polling temporarily unavailable"); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(),30_000);
  void tick();
}
export function stopPaymentPolling(): void { if (timer) clearInterval(timer); }
