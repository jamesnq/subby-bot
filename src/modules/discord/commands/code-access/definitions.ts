import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { allowedCodeAccessAccounts } from "../../../code-access/accounts";

const ACCOUNT_CHOICES = allowedCodeAccessAccounts().slice(0, 25).map((account) => ({ name: account, value: account }));

export const codeAccessCommand = new SlashCommandBuilder()
  .setName("code").setDescription("Đăng ký thiết bị và nhận mã Steam cho gói của bạn")
  .addSubcommand((s) => s.setName("signup").setDescription("Đăng ký một gói và một thiết bị")
    .addStringOption((o) => o.setName("username").setDescription("Steam account của gói").setRequired(true).addChoices(...ACCOUNT_CHOICES))
    .addAttachmentOption((o) => o.setName("purchase_proof").setDescription("Ảnh lịch sử đơn hàng (tối đa 5MB)"))
    .addAttachmentOption((o) => o.setName("device_info").setDescription("Ảnh fullscreen Settings > System > About (tối đa 5MB)")))
  .addSubcommand((s) => s.setName("request").setDescription("Xác minh máy và nhận mã Steam mới nhất")
    .addStringOption((o) => o.setName("username").setDescription("Steam username/account label").setRequired(true).addChoices(...ACCOUNT_CHOICES)))
  .addSubcommand((s) => s.setName("status").setDescription("Xem tất cả gói và máy của bạn"));

export const codeAdminCommand = new SlashCommandBuilder()
  .setName("code-admin").setDescription("Quản trị đăng ký và mã Steam")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName("code").setDescription("Lấy mã Steam mới nhất")
    .addStringOption((o) => o.setName("username").setDescription("Bỏ trống để lấy mọi account").addChoices(...ACCOUNT_CHOICES)))
  .addSubcommand((s) => s.setName("grant").setDescription("Cấp gói thủ công")
    .addUserOption((o) => o.setName("user").setDescription("Người nhận").setRequired(true))
    .addStringOption((o) => o.setName("username").setDescription("Steam account").setRequired(true).addChoices(...ACCOUNT_CHOICES))
    .addStringOption((o) => o.setName("plan").setDescription("Loại gói").setRequired(true).addChoices(
      { name: "1 tháng", value: "month" }, { name: "1 năm", value: "year" }, { name: "Vĩnh viễn", value: "lifetime" },
    ))
    .addStringOption((o) => o.setName("device_id").setDescription("Windows Device ID").setRequired(true)))
  .addSubcommand((s) => s.setName("rebind").setDescription("Cho phép gắn lại máy cho một slot")
    .addUserOption((o) => o.setName("user").setDescription("Chủ slot").setRequired(true))
    .addStringOption((o) => o.setName("slot").setDescription("UUID slot").setRequired(true)))
  .addSubcommand((s) => s.setName("revoke").setDescription("Thu hồi một slot")
    .addUserOption((o) => o.setName("user").setDescription("Chủ slot").setRequired(true))
    .addStringOption((o) => o.setName("slot").setDescription("UUID slot").setRequired(true)))
  .addSubcommand((s) => s.setName("queue").setDescription("Liệt kê escalation đang chờ"))
  .addSubcommand((s) => s.setName("stats").setDescription("Thống kê confidence và Windows mismatch"));
