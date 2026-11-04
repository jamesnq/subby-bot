# Nhắc uống thuốc 🌸

Bot gửi DM cho `640206627273965628` lúc **21:00 Asia/Ho_Chi_Minh mỗi ngày**. Mặc định thêm tối đa **2 lời nhắc**, mỗi lần cách **15 phút**. Confirm hoặc bỏ qua sẽ dừng nhắc. Bot dừng nhắc lúc 00:00. Người nhận vẫn có thể Confirm trên tin cũ trước 21:00 hôm sau. Bot ghi nhận vào lượt ban đầu và lưu giờ bấm thực tế. Bot offline quá một giờ sẽ không gửi bù lời nhắc đầu ngày đó.

## Panel trong Discord

Admin `852584177382981643` dùng `/thuoc panel` trong DM hoặc server (kết quả riêng tư):

- Bật/tắt thông báo; tắt đóng các lần đang chờ. Bật lại áp dụng lịch tương lai, không gửi dồn.
- Chỉnh title, description qua form; nội dung mới áp dụng cho lần uống mới.
- Chỉnh giới hạn nhắc lại 0–5; khoảng cách luôn 15 phút.
- Gửi test vào DM admin; dữ liệu test tách biệt, không tính vào báo cáo thật.
- Theo dõi lần gần nhất, số tin đã gửi, lỗi gửi; tổng kết 7/30 ngày và CSV 365 ngày.
- Chọn **Sửa lịch sử** và nhập ngày của lượt nhắc thật đã có để đổi trạng thái thành **Đã uống**, **Bỏ qua** hoặc **Chưa xác nhận**. Bot lưu người sửa, lượt và trạng thái mới vào nhật ký. Khi admin đánh dấu Đã uống, bot giữ giờ xác nhận nếu đã có và để trống nếu người nhận chưa từng xác nhận cho trạng thái hiện tại.

User đích dùng `/thuoc lichsu`, `/thuoc tuan`, `/thuoc thang`, `/thuoc csv`. Chỉ người nhận mỗi lần nhắc được dùng các nút Confirm, nhắc sau 15 phút và bỏ qua trên tin nhắc. Cập nhật từ panel admin được ghi nhận là chỉnh sửa lịch sử.

Embed màu hồng `#FF8FBE`, title/description theo yêu cầu, có giải thích các nút. Discord quy định màu nút theo loại nút; nền và màu toàn bộ ứng dụng Discord do người dùng chọn.

## Vận hành

`npm ci`, `npm run build`, đăng ký `/thuoc` bằng `npm run register:commands`, triển khai image và restart bot. Bootstrap tạo bổ sung ba bảng medication một cách idempotent trên database hiện có; không cần xóa volume. Tài khoản database cần quyền CREATE TABLE/INDEX. Khi cần apply trước deploy, dùng SQL tương đương trong `src/modules/medication/schema.ts`; không chạy db:push diện rộng lên production có bảng legacy.

Scheduler chạy cùng tiến trình bot, có stop/shutdown, kiểm tra Discord ready và advisory lock PostgreSQL giữa các replica. Dữ liệu được giữ qua restart. Unique `(user_id,day,test)` và khóa dòng chống tạo trùng/xác nhận trùng. Mỗi lần gửi có nonce ổn định. Lỗi gửi hoặc kết quả không rõ dừng retry tự động để tránh spam; panel hiển thị mã lỗi. Snooze chỉ dời thông báo tiếp theo, không tăng giới hạn. Những tin nhắc cũ vẫn có handler toàn cục; xác nhận từ tin cũ của cùng occurrence là idempotent. Tin mới nhất được cập nhật trạng thái, tin trước có thể giữ giao diện cũ nhưng không thể ghi nhận lần nữa.

Lịch sử có CSV UTF-8 BOM, escape dấu nháy và công thức spreadsheet. Nhật ký admin lưu actor/thao tác/thời điểm; snapshot title/description giữ trên mỗi lần nhắc.

## Test tương tác riêng

```
DATABASE_URL=postgresql://<local-user>@localhost/subby_medication_test npx tsx scripts/medication-test.ts
```

Runner đăng ký `/thuoc`, gửi test vào DM admin và chạy nhắc lại **chỉ dữ liệu test**, không sinh lịch hàng ngày cho người nhận thật. Giữ tiến trình chạy để xử lý các nút. Không dùng đồng thời runner với bot production có cùng token sau khi production đã có handler medication (tránh hai handler trả lời một interaction). Tắt runner trước khi deploy.

```
MEDICATION_DB_TEST_URL=postgresql://<local-user>@localhost/postgres npm test
npm run typecheck
npm run build
```

Integration tests tạo schema riêng rồi xóa schema đó; không dùng URL production. Để test lại cùng ngày sau khi đã Confirm, xóa bản ghi test trên database test hoặc chờ ngày tiếp theo; không xóa dữ liệu thật.

## Xác nhận gửi về admin

Production chỉ nhắc user thật `640206627273965628`. Khi user này Confirm, bot ghi nhận trước rồi gửi DM hồng cho `852584177382981643` với giờ nhắc và giờ xác nhận. Double-click không tạo thêm thông báo. Hàng đợi lưu trong DB; lỗi DM admin được thử lại tối đa 3 lần, cách nhau 30 giây, kể cả khi lịch nhắc đang tắt. Dữ liệu test không tạo thông báo xác nhận thật.
