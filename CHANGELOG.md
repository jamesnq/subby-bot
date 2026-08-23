# Changelog

## 0.3.0 — Multimodal + Security Hardening + UX Polish

### Tính năng mới
- **Phân tích ảnh (vision)**: gửi 1–3 ảnh kèm mention hoặc `/ai file:` — bot xem và nhận xét nội dung ảnh (đã smoke-test live với `stealth/ox-alpha` qua OpenRouter). Video/file khác được ghi nhận metadata + trả lời lịch sự. Giới hạn 3 ảnh × 5MB, tự fallback text-only nếu model không hỗ trợ.
- **Session memory**: chat flow nhớ 8 lượt hội thoại gần nhất per guild+user.
- **`/help`**: embed hướng dẫn đầy đủ khả năng của bot.
- **Feedback 👍/👎** trên mọi câu trả lời AI → bảng `feedback`.
- **Health endpoint** (`HEALTH_PORT` env, `/healthz`).

### Bảo mật (từ audit 5-agent)
- `delete_channel`/`delete_category`: requester bắt buộc có Manage Channels
- Hành động **destructive chỉ moderator (Manage Server) duyệt được** — người yêu cầu không thể tự duyệt
- Ping @everyone/@here/role qua send/schedule đều cần quyền Mention Everyone; scheduler dùng allowedMentions chốt lúc duyệt (chống bypass)
- Blocklist quyền nhạy cảm (ManageRoles/Webhooks/Guild, Ban/Kick…) khỏi `set_channel_permissions`
- Prompt injection: sanitize input user, delimiter `<user_request>`, rule #7 trong planner, sanitize cả citation titles
- Lỗi LLM/Discord không còn leak message gốc ra channel

### Sửa lỗi kiến trúc
- `routeAfterValidate` dead-trap: plan rỗng không còn rẽ vào executeTools
- Scheduler: try/catch toàn bộ + jobType lạ đánh dấu failed thay vì sent im lặng
- Embedding client: 4xx fail-fast đúng ý đồ (trước đây bị retry oan), giữ retry 429/5xx/network
- Planner surface lỗi step bị drop; maxTokens tường minh cho reasoning model

### UX
- Typing loop liên tục; thông báo "⚙️ Đang thực hiện…" khi chạy plan đã duyệt
- Preview approval: nội dung thật của embed, Discord timestamp `<t::f>/<t::R>`, nút Xanh cho write / Đỏ "⚠️ Xác nhận vĩnh viễn" cho destructive
- Nhãn tiếng Việt toàn bộ (GHI DỮ LIỆU / PHÁ HỦY); lỗi kèm gợi ý bước tiếp theo; liệt kê bước bị bỏ qua khi plan dừng giữa chừng
- Audit `tool.<name>.executed` từng step thành công

### Tests & CI
- `tests/setup.ts` env giả cho CI; **60/60 tests pass** trên 10 file (thêm: policy boundary, registry helpers, media/multimodal, budget math, cache keys, executor idempotency với mock DB, rate-limit TTL, summary formatting)

## 0.2.0 — MVP hoàn chỉnh theo plan §16
- LangGraph pipeline đầy đủ (gate/router/planner/validator/approval/executor/compose/audit)
- 19 tools: channel/category CRUD, permissions, messages, poll, ticket, escalation, schedule, knowledge search
- Hybrid RAG (pgvector + fulltext) + FAQ cache + budget guard + OpenRouter embeddings
- Approval checkpoint với TTL + plan-hash lock + idempotency + compensation rollback
- CI GitHub Actions (Node 20/22)

## 0.1.0 — Foundation
- Discord adapter, permission guard, tool registry, Drizzle schema, Docker Compose
