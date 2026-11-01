# Lệnh cấp mã reseller

- `/code_reseller account:<account> [xem_lai:<boolean>]`: chỉ user có trong whitelist; giữ nguyên luồng thanh toán hiện tại.
- `/code_whitelist action:add user_id:<Discord ID>`: cấp quyền.
- `/code_whitelist action:remove user_id:<Discord ID>`: thu hồi quyền.
- `/code_admin account:<account>`: đọc mã trực tiếp, không thanh toán, bỏ qua `GMAIL_ENABLED`.

Hai lệnh quản trị chỉ ID `852584177382981643` được thực thi, kể cả trong DM. Whitelist lưu PostgreSQL, ban đầu trống. Lệnh admin vẫn cần OAuth Gmail hợp lệ. Thu hồi whitelist chặn yêu cầu reseller mới; đơn đã thanh toán tiếp tục được xử lý để không mất quyền lợi.

Triển khai: apply `drizzle/0013_reseller_whitelist.sql`, build bot, chạy `npm run register:commands`, rồi khởi động lại bot. Lệnh đăng ký đổi global `/code` thành `/code_reseller`, giữ nguyên lệnh không liên quan.
