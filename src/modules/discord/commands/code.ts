import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { isResellerAllowed } from "../../code-access/reseller-whitelist";
import { config } from "@config";
import { allowedCodeAccessAccountDisplay, allowedCodeAccessAccounts } from "../../code-access/accounts";
import { findLatestSteamCodeForAccount } from "../../gmail/steam-mail";
import { alreadyPurchased, ensureQrOrder, prepareOrder, reconcileOrder, deliverOrder, getOrder, formatCode, type CodeOrder } from "../../payments/service";
import { buildPaymentQr } from "../../payments/qr";
import { isFreshCode } from "../../payments/rules";
import { GmailSteamMailError } from "@infra/gmail/errors";
import { logger } from "@shared/logger";

export const codeCommand = new SlashCommandBuilder()
  .setName("code_reseller")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .setDescription("Lấy mã Steam Guard — 100.000đ/mã mới, xem lại miễn phí")
  .addStringOption(opt => opt.setName("account")
    .setDescription("Tài khoản Steam cần lấy mã")
    .setRequired(true)
    .addChoices(...allowedCodeAccessAccounts().slice(0, 25).map(account => ({ name: account, value: account }))))
  .addBooleanOption(opt => opt.setName("xem_lai").setDescription("Xem lại mã đã mua (có thể không dùng được cho lần đăng nhập mới)"));

export async function handleCodeInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!await isResellerAllowed(interaction.user.id)) {
    await interaction.editReply("Bạn chưa được cấp quyền sử dụng /code_reseller. Vui lòng liên hệ admin.");
    return;
  }
  const raw = interaction.options.getString("account");
  const account = raw ? allowedCodeAccessAccountDisplay(raw) : undefined;
  if (!account) {
    await interaction.editReply("Vui lòng dùng /code_reseller account:<tài khoản> và chọn tài khoản trong danh sách.");
    return;
  }
  if (!config.GMAIL_ENABLED) {
    await interaction.editReply("Dịch vụ Gmail chưa được kích hoạt.");
    return;
  }
  try {
    if (config.CODE_PAYMENT_ENABLED) {
      // An existing paid/pending order is reused, including after bot restarts.
      const { pool } = await import("@infra/database/pool");
      const active = (await pool.query<CodeOrder>("SELECT * FROM bot_code_orders WHERE user_id=$1 AND account=$2 AND status IN ('creating','pending','paid') LIMIT 1",[interaction.user.id,account])).rows[0];
      if (active) {
        await respondOrder(interaction, active.status === "creating" ? await prepareOrder(interaction.user.id,account) : await reconcileOrder(active));
        return;
      }
    }
    const entry = await findLatestSteamCodeForAccount(account);
    if (!entry) {
      await interaction.editReply(`Không tìm thấy email chứa mã Steam Guard cho **${account}**.`);
      return;
    }
    if (config.CODE_PAYMENT_ENABLED) {
      if (entry.messageId && await alreadyPurchased(interaction.user.id,account,entry.messageId,entry.code)) {
        if (interaction.options.getBoolean("xem_lai")) {
          await interaction.editReply(formatCode(entry,account) + "\nMã đã mua — xem lại miễn phí. Mã này có thể không dùng được cho lần đăng nhập mới.");
        } else {
          await interaction.editReply(`Chưa nhận được email chứa mã mới cho **${account}**; email gần nhất vẫn là mã đã mua. Hãy yêu cầu Steam gửi lại mã, chờ email chuyển về Gmail rồi dùng lại /code_reseller. Chưa cần thanh toán.\nMuốn xem lại mã cũ, chọn **xem_lai: Đúng**.`);
        }
        return;
      }
      if (!isFreshCode(entry,config.CODE_PAYMENT_MAX_CODE_AGE_MINUTES)) {
        await interaction.editReply(`Chưa có mã mới còn hạn cho **${account}**. Hãy đăng nhập Steam để nhận email mới rồi dùng lại /code_reseller; chưa cần thanh toán.`);
        return;
      }
      await respondOrder(interaction,await prepareOrder(interaction.user.id,account));
      return;
    }
    await interaction.editReply(formatCode(entry,account));
  } catch (error) {
    const quota = error instanceof GmailSteamMailError && /quota|rate.?limit/i.test(error.message);
    logger.error({ errorType: error instanceof Error ? error.name : "unknown", gmailQuota:quota }, "Steam Gmail lookup failed");
    if (quota) {
      await interaction.editReply("Gmail đang giới hạn số lượt đọc email. Hãy thử lại sau khoảng 1 phút. Đơn đã thanh toán vẫn được giữ; không cần thanh toán thêm.");
      return;
    }
    await interaction.editReply("Chưa thể xử lý yêu cầu lúc này. Vui lòng thử lại; đơn đã thanh toán vẫn được giữ và không cần trả thêm tiền.");
  }
}

async function respondOrder(interaction: ChatInputCommandInteraction | ButtonInteraction, order: CodeOrder): Promise<void> {
  if (order.status === "creating") order = await prepareOrder(order.user_id,order.account);
  order = await ensureQrOrder(order);
  if (order.status === "paid") {
    const outcome = await deliverOrder(order,async entry =>
      (await interaction.editReply({ content: formatCode(entry,order.account),components:[] })).id);
    if (outcome === "fulfilled") return;
    if (outcome === "done") {
      await interaction.editReply({content:"Đơn đã được xử lý. Kiểm tra DM của bot hoặc dùng lại /code_reseller để xem mã đã mua miễn phí.",components:[]});
      return;
    }
    await interaction.editReply({content:`Đã nhận **100.000đ** cho **${order.account}**. Chưa có mã mới còn hạn; hãy đăng nhập Steam để nhận email mới. Bot sẽ thử lại và gửi mã qua DM. Không cần thanh toán thêm.`,components:[checkButton(order)]});
    return;
  }
  if (order.status === "fulfilled") {
    await interaction.editReply({content:"Đơn đã hoàn tất. Dùng /code_reseller với cùng tài khoản để xem lại mã gần nhất đã mua miễn phí.",components:[]});
    return;
  }
  if (order.status === "cancelled" || order.status === "expired") {
    await interaction.editReply({content:"Đơn chưa thanh toán đã hủy hoặc hết hạn. Dùng lại /code_reseller để tạo đơn mới.",components:[]});
    return;
  }
  const {embed,attachment}=await buildPaymentQr(order);
  await interaction.editReply({content:"",embeds:[embed],files:[attachment],attachments:[],components:[checkButton(order)]});
}
function checkButton(order: CodeOrder): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
    .setCustomId(`payment:check:${order.id}`).setLabel("Kiểm tra thanh toán / Nhận mã").setStyle(ButtonStyle.Primary));
}
export async function handlePaymentButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  if (!config.CODE_PAYMENT_ENABLED) { await interaction.editReply("Thanh toán đang tạm dừng."); return; }
  const order = await getOrder(interaction.customId.replace("payment:check:",""),interaction.user.id);
  if (!order) { await interaction.editReply("Không tìm thấy đơn của bạn."); return; }
  try { await respondOrder(interaction,order.status === "creating" ? await prepareOrder(order.user_id,order.account) : await reconcileOrder(order)); }
  catch {
    await interaction.editReply("Chưa thể kiểm tra hoặc gửi mã lúc này. Đơn vẫn được giữ; bạn có thể thử lại mà không cần thanh toán thêm.");
  }
}
