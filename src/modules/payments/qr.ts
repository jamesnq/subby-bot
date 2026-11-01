import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import QRCode from "qrcode";
import type { CodeOrder } from "./service";

export async function buildPaymentQr(order: CodeOrder): Promise<{ embed: EmbedBuilder; attachment: AttachmentBuilder }> {
  const details=order.payment_details;
  if (!details?.qrCode || !details.accountNumber || !details.description) throw new Error("PAYMENT_QR_MISSING");
  // Encode the exact signed payOS payload locally; no third-party image service.
  const png=await QRCode.toBuffer(details.qrCode,{type:"png",width:600,margin:4,errorCorrectionLevel:"M"});
  const name=`payment-${order.id}.png`;
  const embed=new EmbedBuilder().setColor(0x2b8a6e)
    .setTitle("Quét QR để thanh toán")
    .setDescription(`Nhận mã Steam Guard cho **${order.account}**.\nQuét bằng ứng dụng ngân hàng hoặc lưu ảnh QR để thanh toán trên điện thoại.`)
    .addFields(
      {name:"Số tiền",value:`**${new Intl.NumberFormat("vi-VN").format(order.amount)}đ**`,inline:true},
      {name:"Tài khoản Steam",value:order.account,inline:true},
      {name:"Người nhận",value:details.accountName || "Theo thông tin QR",inline:false},
      {name:"Số tài khoản",value:`\`${details.accountNumber}\``,inline:true},
      {name:"Mã ngân hàng (BIN)",value:details.bin,inline:true},
      {name:"Nội dung chuyển khoản",value:`\`${details.description}\``,inline:false},
      {name:"Hết hạn thanh toán",value:`<t:${Math.floor(order.expires_at.getTime()/1000)}:R>`,inline:true},
    )
    .setImage(`attachment://${name}`)
    .setFooter({text:"Giữ nguyên số tiền và nội dung. Bot tự kiểm tra thanh toán và gửi mã qua DM."});
  return {embed,attachment:new AttachmentBuilder(png,{name})};
}
