import { describe, expect, it } from "vitest";
import { isFreshCode,isVerifiedPayment } from "../src/modules/payments/rules";
import type { PaymentLinkDataType } from "@payos/node/lib/type";
const order={order_code:"8000000000000001",amount:100000,provider_link_id:"expected"};
const data={orderCode:8000000000000001,amount:100000,amountPaid:100000,amountRemaining:0,status:"PAID",id:"expected"} as PaymentLinkDataType;
describe("payment verification",()=>{
  it("accepts a fully paid matching order",()=>expect(isVerifiedPayment(order,data)).toBe(true));
  it.each([
    {status:"PENDING"},{amountPaid:99999},{amount:200000},{amountRemaining:1},{id:"other"},{orderCode:8000000000000002},
  ])("rejects mismatched or incomplete payment %j",change=>expect(isVerifiedPayment(order,{...data,...change})).toBe(false));
  it("rejects expired, missing-timestamp and future codes",()=>{
    const now=Date.now();
    expect(isFreshCode({account:"x",code:"DHRMR",messageId:"mail",receivedAt:new Date(now-60000).toISOString()},15,now)).toBe(true);
    for(const receivedAt of [undefined,new Date(now-16*60000).toISOString(),new Date(now+120000).toISOString()]){
      expect(isFreshCode({account:"x",code:"DHRMR",messageId:"mail",receivedAt},15,now)).toBe(false);
    }
  });
});
