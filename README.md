# Discord AI Server Manager

Discord Bot hiểu ngôn ngữ tự nhiên để quản lý server — AI chỉ **đề xuất** tool call, backend mới là thành phần kiểm tra quyền, validate, yêu cầu xác nhận và thực thi Discord API. Toàn bộ thao tác thay đổi server đều có audit log.

Xây dựng theo `Discord_AI_Bot_Implementation_Plan.md`.

## Kiến trúc

```
Discord Event ──> Event Router (interaction/message)
                    │
              Permission Guard (guild/channel/role/rate-limit)
                    │
              LangGraph Orchestrator
              ├── normalizeInput ── deterministicGate (fast-path không LLM)
              ├── intentRouter (model nhỏ)
              ├── retrieveKnowledge (RAG hybrid search)
              ├── planTools (planner + tool schemas chặt)
              ├── validatePlan (policy + quota + Zod)
              ├── requestApproval (checkpoint + buttons + TTL)
              ├── executeTools (idempotency + compensation)
              └── composeResponse / audit
```

Nguyên tắc an toàn:

| Cơ chế | Triển khai |
| --- | --- |
| AI không thực thi | Planner chỉ trả về danh sách `{name, args}`, executor riêng biệt kiểm tra rồi mới chạy |
| Permission guard | Channel allowlist + role allowlist + rate limit trước khi vào graph |
| Risk classification | Đọc từ metadata của tool (`read`/`write`/`destructive`), không hỏi model |
| Human-in-the-loop | Plan `write`/`destructive` dừng ở preview embed + nút Xác nhận/Hủy, TTL mặc định 10 phút |
| Plan hash lock | `sha256(steps)` lưu trong DB, xác minh khi bấm Confirm — không thể thay arguments sau khi duyệt |
| Idempotency | Mỗi bước có key `{requestId}:{index}` unique — restart không làm gọi lại Discord API |
| Compensation | Bước `create_*` bị rollback (xóa tài nguyên vừa tạo) nếu bước sau thất bại |
| Audit | Mọi denial/execution/approval/decision đều ghi `audit_logs` |

## Stack

Node.js 20+ · TypeScript strict · discord.js v14 · LangGraph.js · OpenRouter (mặc định `stealth/ox-alpha`) · PostgreSQL + pgvector · Drizzle ORM · Pino · Vitest

## Setup

### 1. Tạo Discord Application

1. https://discord.com/developers/applications → New Application
2. Tab **Bot**: copy token → `DISCORD_TOKEN`; bật **Message Content Intent**
3. Tab **OAuth2**: copy Application ID → `DISCORD_CLIENT_ID`
4. Invite bot vào server với scope `bot` + `applications.commands`, quyền:
   - View Channels, Send Messages, Embed Links
   - Manage Channels (cho tool tạo/xóa/sửa channel-category)

### 2. Cấu hình môi trường

```bash
cp .env.example .env
# Điền DISCORD_TOKEN, DISCORD_CLIENT_ID, ADMIN_DISCORD_ID, OPENROUTER_API_KEY
# DEV: điền DISCORD_GUILD_ID để đăng ký slash command tức thì
```

### 3. Database

```bash
docker compose up -d          # Postgres 16 + pgvector
npm run db:push               # đẩy schema (12 bảng)
```

Muốn chạy cả bot bằng Docker Compose:

```bash
docker compose --profile app up -d --build
```

`app` profile dùng `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` trong `.env` để tạo `DATABASE_URL` nội bộ, bật `/healthz` trên `HEALTH_PORT` mặc định `3000`, và chờ Postgres healthy trước khi start bot. Trước production, đổi `POSTGRES_PASSWORD`; port Postgres chỉ bind `127.0.0.1` để không mở DB ra public interface.

### 4. Chạy

```bash
npm run register:commands     # đăng ký /ai, /ai-config, /code và /help
npm run dev                   # hoặc npm run build && npm start
```

### 5. Bật AI trong channel

```
/ai-config channel action:add target:#admin-ai      # cho phép bot hoạt động
/ai-config role action:add target:@Staff            # (tuỳ chọn) giới hạn role
/ai-config setting key:destructive_enabled value:true
```

## Sử dụng

```
/ai prompt:list channels
/ai prompt:tạo category Học Tập với 2 channel #thao-luan và #tai-lieu
/ai prompt:nhìn ảnh này rồi nhận xét giúp mình + [đính kèm ảnh]
@Bot (kèm 1-3 ảnh) ảnh này có gì lạ không?
@Bot xóa channel #old-stuff
/ai prompt:lên lịch gửi "Weekly recap 🎉" sau 60 phút ở #general
/ai prompt:luật server là gì?
/code signup username:XardGames1 purchase_proof:<ảnh> device_info:<ảnh>
/code request username:XardGames1
/code status
/code-admin queue
/help
```

### Phân tích ảnh (multimodal)

- Gửi ảnh kèm khi mention bot (tối đa **3 ảnh**, mỗi ảnh ≤5MB) hoặc đính qua option `file` của `/ai`
- Bot xem trực tiếp nội dung ảnh qua vision của model (đã kiểm chứng với `stealth/ox-alpha`)
- Video/file khác: bot ghi nhận metadata và trả lời lịch sự rằng chưa xem trực tiếp được nội dung video
- Model không hỗ trợ vision → tự fallback sang text-only, không bao giờ lỗi cả request

### Trải nghiệm người dùng

- Typing indicator liên tục trong lúc xử lý; `/help` liệt kê đầy đủ khả năng
- Mention bot một lần để mở phiên hội thoại trong đúng channel/user; các tin nhắn tiếp theo không cần mention vẫn được xử lý cho tới khi hết `CONVERSATION_SESSION_TIMEOUT_MINUTES`
- Khi hết phiên, bot ping đúng user một lần cuối để hỏi còn cần hỗ trợ không rồi đóng phiên
- Mọi câu trả lời AI có nút **Hữu ích / Chưa tốt** → lưu bảng `feedback`
- Feedback **Chưa tốt** sẽ lưu snapshot câu hỏi/câu trả lời/context, tạm bỏ cache của câu đó và đưa vào hàng chờ admin review (`/ai-config feedback`)
- Preview approval hiển thị nội dung thật, timestamp Discord tự quy đổi múi giờ người xem
- Hành động phá hủy: nút đỏ "⚠️ Xác nhận vĩnh viễn", **chỉ moderator (Manage Server) được duyệt**
- Lỗi luôn kèm hướng dẫn hành động tiếp theo; các bước bị bỏ qua khi plan thất bại được liệt kê rõ

Với yêu cầu `write`/`destructive`, bot gửi **preview embed** kèm 2 nút:

- **Xác nhận** — chỉ người yêu cầu hoặc moderator (Manage Server) bấm được; plan hash được xác minh rồi mới thực thi
- **Hủy** — huỷ kế hoạch

Nút tự vô hiệu khi hết hạn TTL.

### Knowledge base (RAG)

```bash
mkdir knowledge-data
# thêm file .md/.txt: FAQ, luật server, hướng dẫn…
npm run ingest -- --dir ./knowledge-data --guild <GUILD_ID> \
  [--visibility public|member] [--roles <ROLE_ID1,ROLE_ID2>]
```

Retrieval dùng hybrid search: full-text (`ts_rank` + `pg_trgm`) **kết hợp** vector cosine (`pgvector`) khi cấu hình embedding provider:

```bash
# .env — OpenRouter cũng hỗ trợ embeddings API (chuẩn OpenAI-compatible)
EMBEDDING_API_KEY=sk-or-...                    # dùng chính key OpenRouter
EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=liquid/lfm-2.5-embedding-350m:free
VECTOR_DIMS=1024                               # PHẢI khớp số chiều của model!
```

⚠️ `VECTOR_DIMS` phải đúng bằng số chiều output của model (model trên = 1024; `text-embedding-3-small` = 1536). Đổi model khác chiều → sửa `VECTOR_DIMS` rồi chạy lại `npm run db:push`.

Không cấu hình key → tự fallback fulltext-only, mọi thứ vẫn chạy. Model free bị rate limit thì client tự retry tối đa 3 lần với backoff. Câu hỏi knowledge được cache trong `faq_cache` theo guild + role scope (TTL `KNOWLEDGE_CACHE_TTL_HOURS`, mặc định 24h) — cache hit không tốn LLM call. Tài liệu `visibility=member` bắt buộc phải khai báo `--roles` mới xem được (least privilege). Nếu không tìm thấy nguồn đủ tin cậy, bot từ chối trả lời thay vì đoán.

### Budget guard

Mỗi guild có hạn mức AI mỗi ngày (UTC): `GUILD_DAILY_LLM_CALLS_LIMIT` lượt gọi và `GUILD_DAILY_TOKEN_LIMIT` tokens. Vượt hạn mức → bot trả lời thông báo và dừng xử lý tới ngày mai. Usage ghi trong bảng `usage_daily`.

### Code access (`/code`)

Mỗi gói mua gắn với đúng một thiết bị; một user có thể sở hữu nhiều gói trên nhiều máy. Ảnh bill, Windows Settings và màn hình Steam được nén xuống cạnh dài 1280px, lưu trong bucket S3 private và OCR bằng provider riêng. URL Discord không được lưu làm bằng chứng lâu dài.

Với database đã chạy schema cũ, apply migration backfill trước khi bật bot:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0009_code_access_slots.sql
```

```text
/code signup username:<steam_account> [purchase_proof:<ảnh>] [device_info:<ảnh>]
/code request username:<steam_account>
/code status

/code-admin code [username]
/code-admin grant user:<user> username:<account> plan:<month|year|lifetime> device_id:<id>
/code-admin rebind user:<user> slot:<uuid>
/code-admin revoke user:<user> slot:<uuid>
/code-admin queue
/code-admin stats
```

`signup` OCR hai ảnh trong một call, cho user xác nhận/sửa field trước khi tạo slot. Confidence thấp hoặc dấu hiệu `duplicate_bill`, `order_reused`, `device_shared` được đưa tới mod-log để admin duyệt. `request` tra ngược từ fingerprint máy sang slot, kiểm tra trạng thái, hạn gói, Windows version, cửa sổ Steam và tuổi ảnh trước khi phát mã trong response ephemeral.

Các gate vận hành quan trọng:

- Giữ `CODE_ACCESS_ENABLED=false` và `CODE_ACCESS_ISSUE_CODES=false` cho tới khi migration, S3, OCR và Gmail đã được kiểm tra ở môi trường deploy.
- Khi sẵn sàng, bật `CODE_ACCESS_ISSUE_CODES=true`; mã chỉ đi qua `/code request`, không đi qua chat tự do, log hoặc audit details.
- `CODE_ACCESS_USER_DAILY_LIMIT` dành cho signup; `CODE_ACCESS_REQUEST_DAILY_LIMIT` là bucket riêng cho request.
- Chạy `CODE_ACCESS_OS_POLICY=warn` trong 1–2 tuần, xem `/code-admin stats`, rồi mới chuyển sang `suspend`.
- Bucket `user_att/` phải private. Key bot chỉ cần Put/Get/Delete trong prefix này. Ảnh request xóa sau 30 ngày; ảnh signup xóa sau khi gói hết hạn 90 ngày.
- Rotate S3 access key/secret và OCR API key đã từng chia sẻ qua chat trước khi production.
- Ảnh hướng dẫn public dùng các object cố định `guide/code-access-order.jpg`, `guide/code-access-device.jpg`, `guide/code-access-steam.jpg` trong cùng bucket.

Gmail dùng OAuth scope readonly. Bot thử Gmail trước rồi fallback cache ngắn hạn; cache mã được sweep định kỳ. `/code-admin code` vẫn chỉ dành cho Administrator/server owner/`ADMIN_DISCORD_ID` và luôn trả ephemeral.

### Proactive topics

Bật `PROACTIVE_TOPIC_ENABLED=true` để bot tự khơi gợi trò chuyện khi channel đã im lặng đủ lâu. Scheduler đọc lịch sử chat gần đây, sanitize mention/link trước khi đưa vào prompt, tránh chen vào lúc thành viên đang nói chuyện, tránh tự nối tiếp bot, và giới hạn số topic mỗi guild/ngày bằng `PROACTIVE_TOPIC_MAX_PER_GUILD_DAY`.

## Scripts

| Lệnh | Chức năng |
| --- | --- |
| `npm run dev` | Chạy dev với watch |
| `npm run build` | Compile TS → `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Đồng bộ schema lên DB |
| `npm run register:commands` | Đăng ký slash commands |
| `npm run ingest -- --dir … --guild …` | Nạp knowledge base |
| `npx tsx scripts/test-llm.ts` | Smoke-test kết nối OpenRouter |
| `npx tsx scripts/test-planner.ts` | Smoke-test tool-calling của planner |

### Feedback improvement loop

Admin có thể xem các câu trả lời bị đánh giá chưa tốt:

```text
/ai-config feedback action:pending
/ai-config feedback action:report
/ai-config feedback action:mark_reviewed request_id:<request>
```

Bot không tự sửa giá/knowledge từ feedback. Feedback xấu chỉ vô hiệu cache câu trả lời đó và tạo hàng chờ review để admin quyết định cập nhật CSV, knowledge base hoặc prompt.

## Cấu trúc source

Ba tầng, phụ thuộc chỉ đi một chiều: `modules/ → infrastructure/ → shared/`.

```
src/
├── app.ts                       # entry point, uỷ quyền cho bootstrap
├── bootstrap/                   # DI container + module lifecycle
│   ├── container.ts             # register/resolve, phát hiện circular dep
│   ├── modules.ts               # ModuleRegistry + topological sort
│   ├── modules-registry.ts      # khai báo module thật (import tĩnh)
│   └── index.ts                 # createApp() + graceful shutdown
├── config/                      # env validation bằng Zod
├── shared/                      # primitive thuần, không phụ thuộc domain
│   ├── errors.ts  ids.ts  media.ts  sanitize.ts
│   └── steam-accounts.ts        # chuẩn hoá tên account Steam
├── infrastructure/              # client tới hệ thống ngoài, không chứa logic domain
│   ├── database/pool.ts         # pg Pool + pgvector/pg_trgm bootstrap
│   ├── discord/client.ts        # discord.js Client + gateway intents
│   └── gmail/                   # OAuth refresh + Gmail REST (client, types, errors)
└── modules/                     # bounded context
    ├── agent/                   # LangGraph: graph, state, nodes, executor, prompts
    ├── tools/                   # registry (defineTool + risk) + channels/categories/messages/knowledge
    ├── discord/                 # commands, events, components, permissions, session
    ├── gmail/                   # đọc mail Steam: config, text, mail, steam-codes (barrel: steam-mail.ts)
    ├── code-access/             # entitlement /code: accounts, limits, safety, verification, cache
    ├── knowledge/               # chunk, ingest, retrieve (hybrid search)
    ├── approvals/               # CRUD approval + TTL + hash verify
    ├── feedback/                # thu thập feedback + FAQ cache
    ├── policies/                # plan policy (quota/spam) + rate limit
    ├── database/                # drizzle schema, db, audit
    ├── jobs/                    # scheduler, topic-scheduler, topic-history
    └── observability/           # logger, metrics, health, instance-lock
```

### Quy tắc import

| Từ | Được import | Không được |
|---|---|---|
| `shared/` | `config` | mọi thứ khác |
| `infrastructure/` | `shared/`, `config` | `modules/` |
| `modules/` | `shared/`, `infrastructure/`, module khác | — |

Import xuyên domain dùng path alias (`@shared/*`, `@infra/*`, `@discord/*`, …) khai báo
trong `tsconfig.json`. Alias được resolve ở cả ba chế độ chạy: `tsx` (dev) đọc trực tiếp
tsconfig, `vitest.config.ts` sinh `resolve.alias` từ chính file đó, và `npm run build`
chạy `tsc && tsc-alias` để viết lại thành đường dẫn tương đối trong `dist/`.

## Giới hạn MVP & Roadmap

Theo plan (section 16), các phần **chưa** làm:

- [x] Permission tools (`set_channel_permissions`, `sync_category_permissions`)
- [x] Polls, ticket + moderator escalation tools
- [x] Semantic cache FAQ (bảng `faq_cache`, TTL theo guild+role scope, tự invalidate khi ingest)
- [x] Embedding pipeline (OpenAI-compatible endpoint qua `EMBEDDING_*` env; hybrid retrieval pgvector + fulltext; tự fallback fulltext khi chưa cấu hình)
- [x] Budget guard theo guild/ngày (bảng `usage_daily`, giới hạn LLM calls + tokens)
- [x] Prompt-injection guards (`sanitizeKnowledgeText`) + security test suite
- [x] CI GitHub Actions (typecheck + vitest + build trên Node 20/22)
- [ ] BullMQ + Redis scheduler (hiện dùng in-process poller 30s — đủ cho quy mô nhỏ)
- [ ] Postgres checkpointer cho LangGraph (MemorySaver hiện tại: approval flow đã persist riêng trong DB nên an toàn qua restart)
- [ ] OpenTelemetry/Sentry export (đã có metrics-lite + pino structured logs)
- [ ] Load test

## Lưu ý bảo mật

- **Không bao giờ commit `.env`.**
- API key OpenRouter nên rotate định kỳ; nếu key từng bị chia sẻ công khai (chat/log), revoke ngay tại https://openrouter.ai/settings/keys.
- Bot chỉ hành động trong giới hạn quyền được cấp trên Discord — least privilege: chỉ invite với quyền thật sự cần.
- Destructive actions có thể tắt hẳn per-guild: `/ai-config setting destructive_enabled:false`.

## Nhắc uống thuốc 🌸

DM hàng ngày 21:00 giờ Việt Nam, Confirm, nhắc lại 15 phút, panel `/thuoc panel`, tổng kết và CSV. Xem [hướng dẫn vận hành](docs/medication.md).
