import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { allowedCodeAccessAccounts } from "../../../code-access/accounts";

const ACCOUNT_CHOICES = allowedCodeAccessAccounts()
  .slice(0, 25)
  .map((account) => ({
    name: account,
    value: account,
  }));

export const codeAccessCommand = new SlashCommandBuilder()
  .setName("code")
  .setDescription("Kiểm tra quyền sử dụng account an toàn, không phát mã đăng nhập tự động")
  .addSubcommand((s) =>
    s
      .setName("request")
      .setDescription("Kiểm tra bạn có đủ điều kiện để admin xử lý thủ công không")
      .addStringOption((o) =>
        o
          .setName("username")
          .setDescription("Steam username/account label")
          .setRequired(true)
          .addChoices(...ACCOUNT_CHOICES),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("verify")
      .setDescription("Gửi ảnh mua hàng và ảnh thông tin máy để verify")
      .addStringOption((o) =>
        o
          .setName("username")
          .setDescription("Steam username/account label")
          .setRequired(true)
          .addChoices(...ACCOUNT_CHOICES),
      )
      .addAttachmentOption((o) =>
        o.setName("purchase_proof").setDescription("Ảnh fullscreen bằng chứng mua hàng, rõ ngày giờ").setRequired(true),
      )
      .addAttachmentOption((o) =>
        o.setName("device_info").setDescription("Ảnh fullscreen Windows Settings > About, rõ ngày giờ").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("status")
      .setDescription("Xem trạng thái quyền sử dụng của bạn")
      .addStringOption((o) =>
        o
          .setName("username")
          .setDescription("Steam username/account label")
          .setRequired(true)
          .addChoices(...ACCOUNT_CHOICES),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("review")
      .setDescription("Admin duyệt/từ chối/revoke quyền sử dụng")
      .addUserOption((o) => o.setName("user").setDescription("User cần review").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("username")
          .setDescription("Steam username/account label")
          .setRequired(true)
          .addChoices(...ACCOUNT_CHOICES),
      )
      .addStringOption((o) =>
        o
          .setName("status")
          .setDescription("Trạng thái")
          .setRequired(true)
          .addChoices(
            { name: "approved", value: "approved" },
            { name: "rejected", value: "rejected" },
            { name: "revoked", value: "revoked" },
          ),
      )
      .addIntegerOption((o) =>
        o.setName("days").setDescription("Gia hạn từ hôm nay thêm số ngày này").setMinValue(1).setMaxValue(370),
      ),
  );

export const codeAdminCommand = new SlashCommandBuilder()
  .setName("code-admin")
  .setDescription("Admin lấy mã Steam Guard mới nhất")
  // Phải khớp với gate runtime ở admin.ts (isAdminMember: Administrator hoặc
  // chủ server hoặc ADMIN_DISCORD_ID). ManageGuild ("Manage Server") là quyền
  // yếu hơn Administrator — dùng nó ở đây từng khiến moderator có Manage
  // Server thấy được lệnh (và cả danh sách account) dù bị chặn ngay khi chạy.
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o
      .setName("username")
      .setDescription("Account cần lấy mã mới nhất")
      .addChoices(...ACCOUNT_CHOICES),
  );
