import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { CODE_ADMIN_ID, setResellerAllowed } from "../../code-access/reseller-whitelist";
import { allowedCodeAccessAccounts, allowedCodeAccessAccountDisplay } from "../../code-access/accounts";
import { gmailConfigFromAppConfig } from "../../gmail/config";
import { findLatestSteamCodeForAccount } from "../../gmail/steam-mail";
import { formatCode } from "../../payments/service";

export const codeAdminCommand = new SlashCommandBuilder()
  .setName("code_admin")
  .setDescription("Admin: lấy mã trực tiếp, bỏ qua công tắc Gmail và thanh toán")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .addStringOption(option => option.setName("account").setDescription("Tài khoản Steam").setRequired(true)
    .addChoices(...allowedCodeAccessAccounts().slice(0, 25).map(account => ({ name: account, value: account }))));

export const codeWhitelistCommand = new SlashCommandBuilder()
  .setName("code_whitelist")
  .setDescription("Admin: thêm hoặc xóa quyền sử dụng /code_reseller")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .addStringOption(option => option.setName("action").setDescription("Thao tác").setRequired(true)
    .addChoices({ name: "Thêm", value: "add" }, { name: "Xóa", value: "remove" }))
  .addStringOption(option => option.setName("user_id").setDescription("Discord ID người dùng (dùng được cả trong DM)").setRequired(true));

export async function handleCodeAdminInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== CODE_ADMIN_ID) {
    await interaction.editReply("Bạn không có quyền sử dụng lệnh admin này.");
    return;
  }
  if (interaction.commandName === codeWhitelistCommand.name) {
    const userId = interaction.options.getString("user_id", true);
    const action = interaction.options.getString("action", true);
    if (!/^\d{17,20}$/.test(userId) || !["add", "remove"].includes(action)) {
      await interaction.editReply("Hãy nhập Discord user ID hợp lệ và chọn Thêm hoặc Xóa.");
      return;
    }
    await setResellerAllowed(userId, action === "add");
    await interaction.editReply(`Đã ${action === "add" ? "thêm" : "xóa"} quyền /code_reseller cho ID ${userId}.`);
    return;
  }
  const raw = interaction.options.getString("account", true);
  const account = allowedCodeAccessAccountDisplay(raw);
  if (!account) {
    await interaction.editReply("Vui lòng chọn tài khoản trong danh sách.");
    return;
  }
  try {
    const entry = await findLatestSteamCodeForAccount(account, {
      gmailConfig: { ...gmailConfigFromAppConfig(), enabled: true },
    });
    await interaction.editReply(entry ? formatCode(entry, account) : `Không tìm thấy mã cho **${account}**.`);
  } catch {
    await interaction.editReply("Không thể đọc Gmail. Lệnh admin bỏ qua GMAIL_ENABLED nhưng vẫn cần cấu hình OAuth Gmail hợp lệ.");
  }
}
