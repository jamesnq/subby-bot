import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks=vi.hoisted(()=>({create:vi.fn(),get:vi.fn(),mail:vi.fn(),pool:null as any,schema:"bot_pay_test_"+Date.now()}));
vi.mock("@payos/node",()=>({default:class { createPaymentLink=mocks.create; getPaymentLinkInformation=mocks.get; }}));
vi.mock("../src/infrastructure/database/pool",()=>({get pool(){return mocks.pool;}}));
vi.mock("../src/modules/gmail/steam-mail",()=>({findLatestSteamCodeForAccount:mocks.mail}));
vi.mock("../src/config",()=>({config:{PAYOS_CLIENT_KEY:"test",PAYOS_API_KEY:"test",PAYOS_CHECKSUM_KEY:"test",PAYOS_RETURN_URL:"https://discord.com/channels/@me",PAYOS_CANCEL_URL:"https://discord.com/channels/@me",CODE_PAYMENT_MAX_CODE_AGE_MINUTES:15}}));
import { prepareOrder,reconcileOrder,deliverOrder,getOrder,alreadyPurchased } from "../src/modules/payments/service";
import { Pool } from "pg";
const suite=process.env.PAYMENT_DB_TEST_URL?describe:describe.skip;
suite("payment lifecycle with real isolated Postgres schema",()=>{
  let admin:Pool;
  beforeAll(async()=>{
    admin=new Pool({connectionString:process.env.PAYMENT_DB_TEST_URL});
    await admin.query(`CREATE SCHEMA ${mocks.schema}`);
    mocks.pool=new Pool({connectionString:process.env.PAYMENT_DB_TEST_URL,options:`-c search_path=${mocks.schema}`});
    await mocks.pool.query(readFileSync("drizzle/0011_bot_code_payments.sql","utf8")+readFileSync("drizzle/0012_payment_qr.sql","utf8"));
  });
  afterAll(async()=>{await mocks.pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS ${mocks.schema} CASCADE`);await admin?.end();});
  beforeEach(async()=>{
    await mocks.pool.query("TRUNCATE bot_code_orders");vi.clearAllMocks();
    mocks.create.mockImplementation(async data=>({...data,currency:"VND",qrCode:"test-payload",accountNumber:"123456",accountName:"Test",bin:"970422",paymentLinkId:"link",checkoutUrl:"https://pay.payos.vn/web/link"}));
    mocks.mail.mockResolvedValue({account:"XardGames4",code:"DHRMR",messageId:"mail",receivedAt:new Date().toISOString()});
  });
  async function paid(){const order=await prepareOrder("user","XardGames4");mocks.get.mockResolvedValue({orderCode:Number(order.order_code),amount:100000,amountPaid:100000,amountRemaining:0,status:"PAID",id:"link"});return reconcileOrder(order);}
  it("concurrent requests reuse one pending order and one payment link",async()=>{
    const [a,b]=await Promise.all([prepareOrder("user","XardGames4"),prepareOrder("user","XardGames4")]);
    expect(a.id).toBe(b.id);expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(await getOrder(a.id,"someone-else")).toBeNull();
  });
  it("recovers the same remote order after an ambiguous create timeout",async()=>{
    mocks.create.mockImplementation(async()=>{throw new Error("timeout");});
    mocks.get.mockImplementation(async orderCode=>({orderCode,amount:100000,status:"PENDING",id:"recovered"}));
    const order=await prepareOrder("user","XardGames4");expect(order.provider_link_id).toBe("recovered");expect(order.status).toBe("pending");
  });
  it("does not deliver unpaid requests",async()=>{
    const order=await prepareOrder("user","XardGames4");const send=vi.fn();
    expect(await deliverOrder(order,send)).toBe("done");expect(send).not.toHaveBeenCalled();
  });
  it("mismatched amounts do not unlock a payment",async()=>{
    const order=await prepareOrder("user","XardGames4");mocks.get.mockResolvedValue({orderCode:Number(order.order_code),amount:200000,amountPaid:200000,amountRemaining:0,status:"PAID",id:"link"});
    await expect(reconcileOrder(order)).rejects.toThrow("MISMATCH");expect((await getOrder(order.id,"user"))?.status).toBe("pending");
  });
  it("parallel delivery and repeated checks send once and allow free re-reading",async()=>{
    const order=await paid();const send=vi.fn(async()=>"discord-message");
    await Promise.all([deliverOrder(order,send),deliverOrder(order,send)]);
    expect(send).toHaveBeenCalledTimes(1);expect(await alreadyPurchased("user","XardGames4","mail")).toBe(true);
    expect(await alreadyPurchased("other","XardGames4","mail")).toBe(false);
    expect((await getOrder(order.id,"user"))?.status).toBe("fulfilled");
  });
  it("Gmail failure or a blocked DM retains the paid right for retry",async()=>{
    const order=await paid();mocks.mail.mockRejectedValueOnce(new Error("quota"));
    await expect(deliverOrder(order,vi.fn())).rejects.toThrow("quota");
    await expect(deliverOrder(order,async()=>{throw new Error("blocked DM");})).rejects.toThrow("blocked DM");
    expect((await getOrder(order.id,"user"))?.status).toBe("paid");
    expect(await deliverOrder(order,async()=>"retry-message")).toBe("fulfilled");
  });
  it("stale or previously purchased code never consumes another paid order",async()=>{
    const order=await paid();mocks.mail.mockResolvedValueOnce({account:"XardGames4",code:"DHRMR",messageId:"old",receivedAt:new Date(Date.now()-3600000).toISOString()});
    expect(await deliverOrder(order,vi.fn())).toBe("waiting");expect((await getOrder(order.id,"user"))?.status).toBe("paid");
    await deliverOrder(order,async()=>"sent");const next=await paid();const send=vi.fn();
    mocks.mail.mockResolvedValue({account:"XardGames4",code:"DHRMR",messageId:"different-email-same-code",receivedAt:new Date().toISOString()});
    expect(await deliverOrder(next,send)).toBe("waiting");expect(send).not.toHaveBeenCalled();expect((await getOrder(next.id,"user"))?.status).toBe("paid");
  });
});
