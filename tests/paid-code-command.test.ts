import { beforeEach,describe,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({mail:vi.fn(),query:vi.fn(),purchased:vi.fn(),prepare:vi.fn(),get:vi.fn(),reconcile:vi.fn()}));
vi.mock("../src/modules/code-access/reseller-whitelist",()=>({isResellerAllowed:vi.fn(async()=>true)}));
vi.mock("../src/config",()=>({config:{GMAIL_ENABLED:true,CODE_PAYMENT_ENABLED:true,CODE_PAYMENT_MAX_CODE_AGE_MINUTES:15}}));
vi.mock("../src/infrastructure/database/pool",()=>({pool:{query:m.query}}));
vi.mock("../src/modules/gmail/steam-mail",()=>({findLatestSteamCodeForAccount:m.mail}));
vi.mock("../src/modules/payments/service",()=>({alreadyPurchased:m.purchased,ensureQrOrder:async (order:unknown)=>order,prepareOrder:m.prepare,getOrder:m.get,reconcileOrder:m.reconcile,deliverOrder:vi.fn(),formatCode:()=>"PRIVATE_CODE"}));
import { handleCodeInteraction,handlePaymentButton } from "../src/modules/discord/commands/code";
const interaction=()=>({user:{id:"buyer"},options:{getString:()=>"XardGames4",getBoolean:()=>false},deferReply:vi.fn(),editReply:vi.fn(async()=>({id:"reply"}))}) as any;
describe("paid /code gate",()=>{
  beforeEach(()=>{vi.clearAllMocks();m.query.mockResolvedValue({rows:[]});m.mail.mockResolvedValue({account:"XardGames4",code:"DHRMR",messageId:"mail",receivedAt:new Date().toISOString()});m.purchased.mockResolvedValue(false);m.prepare.mockResolvedValue({id:"order",status:"pending",account:"XardGames4",checkout_url:"https://pay.payos.vn/web/test",order_code:"8000000000000001",amount:100000,expires_at:new Date(Date.now()+900000),payment_details:{qrCode:"test-vietqr-payload",accountNumber:"123456",accountName:"TEST",bin:"970422",description:"SGZBOT XardGames4"}});});
  it("unpaid users see a QR embed without a payment link or Steam code",async()=>{
    const i=interaction();await handleCodeInteraction(i);const response=i.editReply.mock.calls[0][0];expect(response.embeds[0].toJSON().fields.find((f:any)=>f.name==="Số tiền").value).toContain("100.000");expect(response.files[0].attachment.subarray(1,4).toString()).toBe("PNG");expect(response.components[0].toJSON().components.every((b:any)=>!b.url)).toBe(true);expect(JSON.stringify(response)).not.toContain("DHRMR");expect(m.prepare).toHaveBeenCalledWith("buyer","XardGames4");
  });
  it("does not present an already purchased code as a new login code",async()=>{
    m.purchased.mockResolvedValue(true);const i=interaction();await handleCodeInteraction(i);expect(i.editReply.mock.calls[0][0]).toContain("Chưa nhận được email");expect(i.editReply.mock.calls[0][0]).not.toContain("PRIVATE_CODE");expect(m.prepare).not.toHaveBeenCalled();
  });
  it("allows explicitly re-reading a purchased code for free",async()=>{
    m.purchased.mockResolvedValue(true);const i=interaction();i.options.getBoolean=()=>true;await handleCodeInteraction(i);expect(i.editReply.mock.calls[0][0]).toContain("PRIVATE_CODE");expect(m.prepare).not.toHaveBeenCalled();
  });
  it("old email does not create a payable link",async()=>{
    m.mail.mockResolvedValue({account:"XardGames4",code:"DHRMR",messageId:"old",receivedAt:new Date(Date.now()-3600000).toISOString()});const i=interaction();await handleCodeInteraction(i);expect(m.prepare).not.toHaveBeenCalled();expect(JSON.stringify(i.editReply.mock.calls)).not.toContain("DHRMR");
  });
  it("another user cannot check or redeem someone else's order",async()=>{
    m.get.mockResolvedValue(null);const i={...interaction(),customId:"payment:check:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"};await handlePaymentButton(i);expect(m.get).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","buyer");expect(m.reconcile).not.toHaveBeenCalled();
  });
});
