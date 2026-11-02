# Kế hoạch nhắc uống thuốc qua Discord

Ngày lập: 2026-11-01. Cơ sở: `main` / `24da4be` sau khi pull từ `origin`.
Trạng thái ban đầu: đề xuất ngày 2026-11-01. Ngày 2026-11-02 đã triển khai phiên bản theo yêu cầu cập nhật; xem `docs/medication.md` để biết phạm vi thực tế và hướng dẫn vận hành. Các tính năng mở rộng trong tài liệu này vẫn là backlog.

## 1. Phạm vi và giả định

- Người nhận đầu tiên: Discord user `640206627273965628` (lưu ID dạng string).
- Gửi DM riêng hàng ngày, có nút xác nhận đã uống và xem lịch sử.
- Múi giờ đề xuất: `Asia/Ho_Chi_Minh`; giờ cụ thể và tên thuốc chưa được cung cấp.
- MVP hỗ trợ một lịch hàng ngày, một lời nhắc chung hoặc một thuốc do người dùng nhập. Thiết kế dữ liệu cho phép mở rộng nhiều thuốc/nhiều giờ sau này.
- Giờ `08:00` trong ví dụ chỉ minh họa, không phải lịch được bật mặc định.
- Nội dung tên thuốc, liều và ghi chú lấy nguyên từ cấu hình người dùng. Bot không tự đề xuất liều, đổi lịch điều trị hoặc bảo uống bù.
- Dùng PostgreSQL hiện có; không cần thêm Redis, dịch vụ cron bên ngoài hay LLM cho luồng này.

## 2. Những gì đã kiểm tra trong code mới

| Thành phần | Hiện trạng | Cách tích hợp |
| --- | --- | --- |
| `src/modules/discord/events/interaction-create.ts` | Định tuyến slash command và nút thanh toán | Thêm `/thuoc`, nút `med:*`, modal liên quan |
| `src/modules/discord/commands/code.ts` | Có command hỗ trợ Guild và BotDM, button và trả lời riêng | Tham khảo mẫu Discord UI; tách quyền nhắc thuốc khỏi reseller |
| `src/modules/payments/service.ts` | Polling 30 giây, kiểm tra client ready, gửi DM qua `client.users.fetch(...).send(...)` | Tham khảo vòng đời worker và gửi DM; không dùng chung nghiệp vụ thanh toán |
| `src/bootstrap/modules-registry.ts` | Có đăng ký/bootstrap/shutdown theo module | Thêm module medication phụ thuộc database và discord |
| `src/modules/observability/instance-lock.ts` | Khóa bằng cổng TCP | Không đủ chống trùng giữa nhiều container; cần claim job ở DB |
| `src/modules/database/schema.ts` | Export các schema Drizzle | Bổ sung schema medication |
| `src/modules/discord/deploy-commands.ts` | Đăng ký từng global command | Bổ sung `/thuoc`, giữ các lệnh hiện tại |
| `docker-compose.dokploy.yml` | PostgreSQL 16, mount SQL 0011–0013 lúc init | Bổ sung migration và hướng dẫn apply trên DB đã có volume |

Scheduler `src/modules/jobs/scheduler.ts` đã bị xóa ở bản mới. Không lên kế hoạch dựa vào file này hoặc các luồng AI đã bị xóa. Journal Drizzle hiện dừng ở 0010 trong khi SQL đã có tới 0013; phải kiểm tra quy trình migration thực tế, không mặc định journal phản ánh đầy đủ production.

## 3. Trải nghiệm MVP

### Thiết lập

Admin được cấu hình trong `ADMIN_DISCORD_ID` tạo lịch cho user đích; user đích cũng có thể tự thiết lập lịch của mình. Giai đoạn đầu giới hạn feature cho user này bằng cấu hình riêng, không tái sử dụng whitelist reseller.

Luồng `/thuoc setup` mở form nhập giờ `HH:mm`, múi giờ, tên hiển thị và ghi chú tùy chọn. Có bản xem trước, kiểm tra DM và nút bật lịch. Kiểm tra DM được thực hiện khi triển khai và người dùng chủ động chọn, không gửi từ bước lập kế hoạch này. Lịch mới chỉ tạo các lần nhắc từ thời điểm kích hoạt trở đi.

Ví dụ tin nhắc:

```text
💊 Đến giờ uống thuốc
Lịch: Thuốc buổi sáng
Ngày: 02/11/2026 · 08:00 (giờ Việt Nam)
Trạng thái: Chưa xác nhận

[✅ Đã uống] [⏰ Nhắc lại 15 phút] [⏭ Bỏ qua]
[📋 Lịch sử]
```

- **Đã uống:** ghi nhận một lần duy nhất, mặc định giờ uống bằng giờ bấm; cập nhật tin thành “Đã xác nhận lúc 08:07”. Có thao tác sửa giờ nếu thực tế đã uống trước đó.
- **Nhắc lại:** chỉ thay giờ thông báo tiếp theo của lần nhắc hiện tại; giữ nguyên giờ dự kiến và lịch ngày mai. Mốc 15 phút là tùy chọn giao diện, không phải hướng dẫn về thời điểm dùng thuốc.
- **Bỏ qua:** hỏi xác nhận trong giao diện, lý do tùy chọn; ghi rõ đây là trạng thái user tự báo.
- **Lịch sử:** xem 7/30 ngày, phân trang, chọn khoảng ngày; hiển thị ngày, giờ dự kiến, giờ user khai đã uống, giờ ghi nhận và trạng thái.
- Chỉ chủ sở hữu được xác nhận/sửa bản ghi của mình; admin có quyền vận hành lịch không đồng nghĩa có quyền xác nhận đã uống thay user.
- Sau khi xác nhận hoặc bỏ qua, hủy các thông báo đang chờ của lần đó. Nút lịch sử vẫn dùng được.
- Bấm tin cũ chỉ tác động đúng lần nhắc trên tin đó. Nếu đã qua ngày, mở luồng ghi bổ sung với ngày và giờ rõ ràng, không tự coi là lần uống hôm nay.

Các lệnh dự kiến:

| Lệnh | Mục đích | Giai đoạn |
| --- | --- | --- |
| `/thuoc setup` | Thiết lập/chỉnh sửa một lịch; preview trước khi kích hoạt | MVP |
| `/thuoc homnay` | Xem lần uống hôm nay và các nút thao tác | MVP |
| `/thuoc lichsu` | Khoảng ngày, trạng thái và phân trang | MVP |
| `/thuoc ghilai` | Ghi bổ sung/sửa trạng thái hoặc giờ, lưu dấu vết thay đổi | MVP |
| `/thuoc tamdung`, `/thuoc tieptuc` | Tạm dừng và tiếp tục lịch | MVP |
| `/thuoc thongke` | Tổng hợp tuần/tháng | Sau MVP |
| `/thuoc xuat` | Xuất lịch sử CSV riêng tư | Sau MVP |

Command trong guild trả kết quả riêng cho người gọi; DM chỉ chứa dữ liệu của chủ sở hữu. Nếu muốn người khác xem lịch sử, bổ sung cơ chế chia sẻ cụ thể ở giai đoạn sau.

## 4. Quy tắc trạng thái và lịch sử

Tách **trạng thái uống** khỏi **trạng thái gửi tin**:

- Uống: `pending` → `taken` hoặc `skipped`; hết cửa sổ theo dõi → `unconfirmed`.
- Thông báo: `queued`, `sending`, `sent`, `retry`, `blocked`, `unknown`, `cancelled`.
- `unconfirmed` nghĩa là chưa có xác nhận; không suy luận user chưa uống.
- Gửi DM lỗi không được tính là user bỏ thuốc. Lịch sử hiển thị riêng “Không gửi được lời nhắc”.
- `taken_at` là giờ user khai đã uống; `recorded_at` là giờ hệ thống ghi nhận. Sửa giờ hoặc ghi bổ sung phải lưu được cả hai.
- Sửa `taken`/`skipped`/`unconfirmed` qua luồng chỉnh sửa có audit; không âm thầm ghi đè bản ghi cũ. Sửa lịch chỉ áp dụng tương lai, giữ snapshot quá khứ.
- Sau khi hết cửa sổ theo dõi, đóng nhắc lại nhưng vẫn cho user ghi bổ sung. Cửa sổ MVP đề xuất kết thúc vào cuối ngày địa phương và trước lần nhắc tiếp theo.
- Khi pause: ngừng tạo/gửi các thông báo mới và hủy job đang chờ; vẫn đọc/sửa lịch sử. Resume bắt đầu từ thời điểm tiếp tục, không phát lại loạt tin trong thời gian pause.

Lịch sử ví dụ:

| Ngày | Dự kiến | User khai đã uống | Trạng thái |
| --- | --- | --- | --- |
| 02/11 | 08:00 | 08:07 | Đã xác nhận |
| 03/11 | 08:00 | — | Chưa xác nhận |
| 04/11 | 08:00 | — | User chọn bỏ qua |

Nếu làm thống kê, gọi là “tỷ lệ xác nhận đã uống”. Mẫu số là các lần đã đến hạn trong giai đoạn lịch hoạt động, loại ngày pause/hủy trước giờ nhắc; hiển thị cả số lần lỗi gửi tin để tránh diễn giải sai. Không coi số liệu là bằng chứng y khoa về việc dùng thuốc.

## 5. Dữ liệu và độ tin cậy

Đề xuất bốn bảng, bổ sung bằng migration `0014_medication_reminders.sql` nếu số này vẫn trống lúc triển khai:

| Bảng | Dữ liệu chính |
| --- | --- |
| `medication_schedules` | ID, owner user ID, tên/ghi chú, local time, timezone IANA, ngày bắt đầu/kết thúc, active/paused, version, next occurrence, creator |
| `medication_occurrences` | ID, schedule ID, scheduled_at UTC, local_date, snapshot tên/ghi chú/timezone/giờ, trạng thái uống, taken_at, recorded_at, snoozed_until, close_at |
| `medication_deliveries` | occurrence ID, loại/lượt nhắc, due_at, status, attempts, next_retry_at, lease token/expiry, nonce, channel/message ID, mã lỗi |
| `medication_events` | occurrence/schedule ID, actor ID, action, before/after, recorded_at, Discord interaction ID để chống replay |

Ràng buộc: unique `(schedule_id, scheduled_at)`; unique `(occurrence_id, notification_kind, sequence)`; unique interaction ID khi có; index các job đến hạn và `(owner_user_id, scheduled_at)` phục vụ lịch sử. Thay đổi trạng thái, ghi audit và hủy job phải nằm trong cùng transaction. Dùng khóa ngoại và kiểm tra trạng thái hợp lệ.

Worker đề xuất tick mỗi 30 giây, chỉ chạy khi Discord ready:

1. Materialize những lần nhắc đến hạn dựa trên lịch lưu ở DB; insert occurrence và initial delivery trong transaction. Lưu tiến độ để restart không bỏ mất hoặc tạo lại cùng lần.
2. Claim delivery bằng transaction ngắn và `FOR UPDATE SKIP LOCKED`, ghi lease có thời hạn; commit trước khi gọi Discord. PostgreSQL mô tả cơ chế này phù hợp cho nhiều consumer của hàng đợi: [SELECT — PostgreSQL 16](https://www.postgresql.org/docs/16/sql-select.html).
3. Kiểm tra lại lịch còn hoạt động và occurrence chưa kết thúc trước khi gửi. Worker cũ không được cập nhật kết quả nếu đã mất lease.
4. Gửi DM bằng bot token, lưu message ID; retry có backoff/jitter và giới hạn. Lỗi DM bị chặn chuyển `blocked`, ngừng retry liên tục; chỉ thử lại khi user chọn kiểm tra DM hoặc bật lại lịch.
5. Restart quét job còn dở. Đề xuất chỉ gửi lời nhắc quá giờ trong khoảng 60 phút; nếu quá khoảng này, ghi lý do không gửi và cho xem/ghi bổ sung trong lịch sử. Đây là chính sách thông báo đề xuất, cần điều chỉnh theo nhu cầu; không gửi dồn tin cũ.
6. Lịch là giờ địa phương, không cộng cố định 24 giờ vào UTC. Validate timezone; test qua ngày/tháng/năm. Nếu mở rộng ngoài Việt Nam, quy định rõ giờ DST không tồn tại bị bỏ qua và giờ lặp chỉ sinh một occurrence.

Chống trùng cần hai lớp: unique/transaction bảo vệ dữ liệu, nonce ổn định cho mỗi delivery hạn chế gửi DM trùng. Discord chỉ deduplicate `nonce` với `enforce_nonce` trong khoảng vài phút; đây không phải bảo đảm exactly-once vĩnh viễn: [Create Message](https://docs.discord.com/developers/resources/message#create-message).

Nếu Discord đã nhận tin nhưng tiến trình chết trước khi lưu message ID, đánh dấu kết quả chưa rõ và đối soát tin gần đây bằng occurrence ID trong component. Chỉ retry tự động khi còn có thể deduplicate/đối soát; ngoài cửa sổ mà không xác minh được thì giữ `unknown` cho vận hành xử lý, không resend mù. DB vẫn chỉ có một lần xác nhận dù hiếm khi có tin trùng. Có race giữa xác nhận và HTTP gửi đang bay; khi hoàn tất phải kiểm tra lại trạng thái và cập nhật tin mới thành trạng thái cuối, không tạo thêm vòng nhắc.

Nút dùng ID dạng `med:taken:<occurrenceId>` và handler toàn cục, không dựa vào collector trong RAM. Mọi truy vấn thao tác đều ràng buộc owner với `interaction.user.id`; không tin user ID từ custom ID. Defer interaction trước khi làm I/O dài vì Discord yêu cầu phản hồi đầu trong 3 giây; token interaction có hạn 15 phút nên gửi hàng ngày dùng bot token, mỗi lần bấm là interaction mới: [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding).

## 6. Các chức năng liên quan nên cân nhắc

| Ưu tiên | Chức năng | Giá trị / phạm vi |
| --- | --- | --- |
| P0 | Nhắc hàng ngày + xác nhận + lịch sử | Hoàn thành nhu cầu chính |
| P0 | Snooze, bỏ qua, ghi bổ sung/sửa nhầm, pause/resume | Xử lý các tình huống dùng hàng ngày |
| P0 | Báo tình trạng DM, phục hồi restart, chặn bấm hộ | Tránh nhắc thất lạc và lịch sử sai |
| P1 | Tự nhắc lại khi chưa xác nhận | Tùy chọn bật, tối đa 2 lần/ngày; khoảng cách cấu hình; dừng khi taken/skipped/pause |
| P1 | Nhiều thuốc, nhiều khung giờ, lịch theo thứ | Mỗi lần uống có trạng thái riêng; nếu gom thành một tin vẫn có thao tác riêng từng thuốc |
| P1 | Đợt dùng có ngày kết thúc | Tự dừng nhắc khi kết thúc; không tự gia hạn |
| P1 | Tổng kết tuần/tháng + lịch dạng calendar | Xem xu hướng xác nhận, các ngày thiếu dữ liệu, lỗi gửi |
| P1 | Đếm lượng thuốc còn lại, nhắc mua thêm | Số lượng ban đầu do user nhập; giảm khi xác nhận, điều chỉnh lại khi sửa bản ghi; không giảm khi chỉ gửi lời nhắc |
| P1 | Xuất CSV | User tự tải lịch sử với timezone và thời điểm ghi nhận |
| P2 | Ghi chú triệu chứng/cảm nhận | Nhật ký tự báo; không tự chẩn đoán hoặc đổi thuốc |
| P2 | Nhắc tái khám/mua thuốc | Các lịch riêng do người dùng thiết lập |
| P2 | Chia sẻ cho người thân | Chủ dữ liệu chọn người xem, phạm vi, điều kiện thông báo và có thể thu hồi |
| P2 | Đổi múi giờ khi đi xa | Hiển thị preview các lần nhắc tiếp theo trước khi đổi; giữ lịch sử theo timezone cũ |

Đề xuất phát hành P0 trước, sau đó ưu tiên tự nhắc lại, nhiều khung giờ và lượng thuốc còn lại. Chưa cần dashboard web hoặc AI ở giai đoạn đầu.

## 7. Các đầu việc triển khai

1. **Schema và logic nghiệp vụ:** thêm `src/modules/database/schema/medication.ts`, export schema, SQL migration, `src/modules/medication/{repository,service,schedule}.ts`. Hoàn thành trạng thái, snapshot, timezone, phân quyền và audit.
2. **Discord UI:** thêm `src/modules/discord/commands/medication.ts`, component/form handlers; cập nhật router và đăng ký command. Triển khai setup, hôm nay, confirm, snooze, skip, history, sửa và pause.
3. **Worker và cấu hình:** thêm `src/modules/medication/scheduler.ts` và delivery service; gắn bootstrap/shutdown. Cờ `MEDICATION_REMINDERS_ENABLED=false` mặc định, allowlist ban đầu chứa user đích; timezone/giờ là dữ liệu lịch, không hardcode giờ trong worker. Khi tắt worker vẫn cho xem/sửa lịch sử. Shutdown dừng nhận job, đợi lượt đang chạy trong giới hạn rồi để lease phục hồi.
4. **Kiểm thử và vận hành:** clock giả lập + Discord mocks + integration PostgreSQL riêng; cập nhật `.env.example`, README, compose và hướng dẫn migration. Metrics: số gửi thành công/lỗi/unknown, job quá hạn, lần tick cuối; log dùng ID và mã lỗi, không log tên thuốc hay nội dung nhật ký.
5. **Pilot:** apply migration trên DB kiểm thử; kiểm tra DM, click, history, restart; sau đó mới cấu hình giờ thật và bật cho user `640206627273965628`.

Không chạy `db:push` diện rộng một cách mù quáng lên production vì schema còn nhiều bảng legacy, trong khi compose mới chỉ khởi tạo tập bảng tối thiểu. Apply migration bổ sung đã review cho cả database mới lẫn database có volume; bổ sung lệnh migration rõ ràng trước khi deploy worker. Khi rollback ứng dụng, tắt worker và giữ bảng/lịch sử.

## 8. Tiêu chí nghiệm thu

- Mỗi occurrence có đúng một bản ghi; khi hoạt động bình thường lời nhắc được đưa đi trong một chu kỳ polling sau giờ đã đặt (không cam kết thời điểm Discord hiển thị).
- Chỉ user đích được xác nhận; double-click, hai thiết bị hoặc replay không tạo thêm lần uống/audit cho cùng interaction.
- Nút cũ vẫn hoạt động sau restart; lịch sử lấy từ DB, không phụ thuộc tin còn tồn tại trên Discord.
- Restart trước/sau gửi, hai worker đồng thời, lease hết hạn và kết quả gửi không rõ đều có test; không khẳng định network delivery exactly-once.
- Confirm/skip đua với snooze/worker vẫn cho một trạng thái cuối nhất quán và hủy các job còn chờ.
- Pause, đổi giờ và resume không gửi bù hàng loạt hoặc viết lại lịch sử.
- Test gần 00:00, cuối tháng/năm, timezone invalid, bot offline dài ngày; backfill được xử lý theo batch giới hạn.
- DM bị chặn, message bị xóa, lỗi 429/5xx không làm mất lịch sử hay crash vòng worker.
- Lịch sử 7/30 ngày phân trang đúng owner; sửa giờ có audit; trạng thái chưa xác nhận và lỗi gửi được phân biệt.
- Chạy typecheck, kiểm tra dependency boundary, test hiện có và test module; PostgreSQL integration dùng database riêng, không dùng production. Smoke test các lệnh reseller/thanh toán để bảo đảm router không ảnh hưởng luồng đang có.

## 9. Thông tin còn mở trước khi kích hoạt

- Giờ nhắc hàng ngày và xác nhận dùng múi giờ Việt Nam.
- Nhắc chung hay theo thuốc cụ thể; tên/ghi chú nếu cần.
- Có bật tự nhắc lại không; nếu có, khoảng cách và số lần tối đa.
- Nếu người yêu cầu muốn xem lịch sử của user đích: xác định cơ chế chủ dữ liệu cấp quyền; MVP mặc định lịch sử chỉ thuộc chủ sở hữu.

Các mục này không chặn việc review kế hoạch. Không tự bật lịch với giờ minh họa khi chưa có cấu hình thực tế.
