# Thanh toán lấy mã Steam

- Giá cố định 100.000 VNĐ/mã mới, thanh toán từng đơn, không có ví nạp tiền.
- `/code account:<tên>` bắt buộc cho cả DM và server. Tài khoản Discord là chủ đơn.
- Trước khi tạo đơn, đọc Gmail trực tiếp. Chỉ mời thanh toán khi có email mới trong 15 phút (CODE_PAYMENT_MAX_CODE_AGE_MINUTES).
- Xem lại mã mà chính user đã mua là miễn phí, kể cả Steam gửi lại cùng mã trong email khác. User khác không được dùng quyền của người mua.
- Một user/account chỉ có một đơn đang tạo/chờ/đã trả tiền. Bấm lặp dùng lại đơn đó.
- Chỉ ghi nhận thanh toán sau API payOS có chữ ký hợp lệ, đúng orderCode/linkId/amount và PAID đủ 100.000đ.
- Bot kiểm tra mỗi 30 giây; nút Kiểm tra thanh toán lấy trạng thái ngay. Link return/cancel không xác nhận tiền.
- Trả mã qua DM tự động hoặc qua phản hồi riêng khi user kiểm tra đơn. Nếu DM bị chặn, mở DM với bot và bấm nút hoặc gọi /code.
- Gmail lỗi, email quá cũ, chưa có mã mới hoặc gửi Discord thất bại: đơn giữ PAID để nhận mã sau, không thu thêm. Không tự hoàn tiền qua payOS.
- Chỉ đánh dấu hoàn tất sau Discord xác nhận gửi thành công. Khóa hàng trong transaction chống hai worker tiêu thụ cùng đơn.
- Nếu Discord đã nhận tin nhưng kết nối DB mất ngay trước COMMIT, lần thử lại có thể gửi cùng mã lần nữa; vẫn chỉ dùng một khoản thanh toán.
- Không lưu mã Steam hoặc token Discord interaction trong bảng thanh toán. Lưu Gmail message ID, Discord message ID và HMAC của mã (key là checksum key payOS) để đối soát/chống thu tiền trùng.

## Cấu hình và triển khai

1. Apply migrations `drizzle/0011_bot_code_payments.sql` và `drizzle/0012_payment_qr.sql` bằng tài khoản DB của bot; migration chỉ thêm bảng/index, không xóa dữ liệu.
2. Điền PAYOS_CLIENT_KEY, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY trong .env (không commit). CODE_PAYMENT_ENABLED=true bật cổng thanh toán. Giá luôn lấy từ server, không từ nút hay client.
3. Dùng chung merchant với sgz: đơn bot có description SGZBOT và orderCode trong [8000000000000000,8001000000000000). Website tạo đơn dưới 8000000000000000.
4. Deploy thay đổi `sgz/src/services/payment.service.ts` trước khi mở cho khách. Webhook vẫn kiểm tra chữ ký, bỏ qua đơn bot không thuộc website và không cộng số dư SGZ. Bot không gọi confirmWebhook, không thay webhook hiện có.
5. Return/cancel URL của bot dẫn về Discord DM. Bot dùng API đã xác minh để đối soát nên không cần endpoint public.
6. Chạy build/tests rồi restart bot. Cần một thanh toán thật do chủ shop thực hiện để xác minh xuyên suốt ngân hàng -> payOS -> Discord; test tự động dùng provider giả, không chuyển tiền.

## Kiểm tra

- `npm test`: unit tests; integration suite bỏ qua nếu thiếu PAYMENT_DB_TEST_URL.
- `PAYMENT_DB_TEST_URL=<postgres-url> npm test -- tests/payment-integration.test.ts`: tạo schema riêng tạm thời, kiểm tra transaction/concurrency rồi xóa schema đó; không sửa bảng nghiệp vụ.
- Đối soát `bot_code_orders`: order_code, user_id, account, amount, status, paid_at, fulfilled_at, gmail_message_id, discord_message_id. Không đăng công khai dữ liệu người mua.

## QR trong Discord

Thông báo thanh toán là embed riêng tư với ảnh PNG 600x600 đính kèm, tạo trực tiếp từ qrCode đã được SDK payOS xác minh chữ ký. Hiển thị chính xác số tiền, tên người nhận, số tài khoản, BIN và nội dung do payOS trả về; không tự ghép nội dung theo mã đơn. Không có nút mở checkout, chỉ có nút kiểm tra thanh toán. Link cũ thiếu dữ liệu QR chỉ được đổi sang đơn QR sau khi payOS xác nhận hủy đơn chưa trả tiền; đơn đã trả tiền được giữ nguyên.
