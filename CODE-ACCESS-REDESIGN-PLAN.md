# Plan: làm lại luồng `/code` — `signup` + `request`

Trạng thái: **PLAN ONLY — chưa implement. Chỉ code khi được yêu cầu.**
Ngày: 2026-09-02 (rev 4)
Scope: `src/modules/code-access/*`, `src/modules/discord/*`, `src/infrastructure/storage/`,
`src/infrastructure/ocr/`, `src/config/index.ts`, `drizzle/0009_*.sql`.

Rev 4 chốt: OS policy `warn` → `suspend`, escalate admin khi confidence thấp, thêm `sharp`,
**hoãn DM**, **hoãn Payload**.

---

## 0. Tóm tắt

| Lệnh | Vai trò | Trạng thái |
|---|---|---|
| `/code signup` | Đăng ký 1 gói: OCR bill + máy, bind gói↔máy | **mới** |
| `/code request <username>` | Xin mã: OCR ảnh, khớp máy đã bind, **trả mã** | **viết lại** |
| `/code status` | Xem các gói + máy của mình | giữ, mở rộng N máy |
| `/code verify` · `/code review` | — | **xoá** |
| `/code-admin` | Lấy mã + cứu hộ + duyệt escalation | mở rộng |

Mô hình dữ liệu: **1 gói mua = 1 thiết bị. 1 user = N gói = N thiết bị. 1 máy vật lý = 1 user.**

Luồng mặc định **tự quyết**, không có hàng chờ. Chỉ khi OCR confidence thấp mới đẩy sang admin (§6).

**Hoãn vòng này:** hỗ trợ DM (§14) · Payload admin (§15). Ghi lại để không mất context.

---

## 1. ⚠️ Bảo mật — đọc trước

### 1.1 Credentials đã lộ qua chat

S3 access key, S3 secret key, và API key OCR đều đã được chia sẻ qua kênh chat trong lúc lập plan.
**Rotate cả 3** tại MinIO console và cheapkeyai.shop trước khi chạy production.

Tạo **key MinIO riêng cho bot**, policy chỉ `s3:PutObject` / `s3:GetObject` / `s3:DeleteObject` trên
`subby/user_att/*`. Đừng dùng chung key với web sgz — bot lộ thì không kéo theo toàn bộ media của web.

Plan cố ý không ghi giá trị thật vào file nào trong repo; chỉ `.env` (đã gitignore, [.gitignore:4](.gitignore)).

### 1.2 Bật phát mã Steam Guard — `CODE_ACCESS_ISSUE_CODES=true` (đã chốt)

Codebase hiện cố tình từ chối relay mã 2FA ở 4 chỗ:
[safety.ts:60](src/modules/code-access/safety.ts:60) ·
[entitlement.ts:135](src/modules/code-access/service/entitlement.ts:135) ·
[verification/prompt.ts:7](src/modules/code-access/verification/prompt.ts:7) ·
gate admin [admin.ts:22](src/modules/discord/commands/code-access/admin.ts:22).

Bật là hợp lệ — account là tài sản của shop, người mua đang thuê. 7 gate dưới đây **bắt buộc**:

1. Mã **chỉ** ephemeral. Không bao giờ vào channel công khai.
2. Mã chỉ phát khi slot `approved`, còn hạn, **và fingerprint máy trong ảnh khớp máy đã bind**.
3. Rate limit riêng `CODE_ACCESS_REQUEST_DAILY_LIMIT=5`/user/ngày, tách khỏi limit signup.
4. `writeAudit('code_access.code_issued')` mỗi lần — user, slot, account, thời điểm.
5. `redactCodeAccessLogValue` / `codeAccessLogFields` giữ nguyên. Mã **không bao giờ** vào pino.
6. `safety.ts` **không nới regex**. Chỉ đường `/code request` đã qua entitlement check được bypass;
   đường agent/chat tự do vẫn từ chối như cũ.
7. Nhắc user mã Steam Guard hết hạn sau vài phút.

Giữ cờ `CODE_ACCESS_ISSUE_CODES` để tắt khẩn cấp mà không cần deploy lại.

---

## 2. Lưu trữ ảnh — S3 (MinIO subgamezone)

### 2.1 Vì sao không dùng Discord CDN

URL attachment Discord có `?ex=&is=&hm=` và **hết hạn ~24h**. Cột `purchase_proof_url` /
`device_info_url` hiện tại ([code-access.ts:13](src/modules/database/schema/code-access.ts:13))
đang mục dần — admin mở lại sau 1 ngày là ảnh chết. Provider OCR cũng có thể không fetch được CDN Discord.

### 2.2 Học từ `C:\Workspace\Code\web\sgz`

sgz dùng `s3Storage()` của Payload
([sgz/src/plugins/index.ts:16](C:\Workspace\Code\web\sgz\src\plugins\index.ts)):

```ts
s3Storage({
  collections: { media: { prefix: 'media' } },
  bucket: env.S3_BUCKET,
  config: {
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,          // <- BẮT BUỘC cho MinIO
    credentials: { accessKeyId: …, secretAccessKey: … },
    region: env.S3_REGION,
  },
})
```

Bot không có Payload → dùng thẳng `@aws-sdk/client-s3` với **đúng bộ option đó**.

### 2.3 Config

```
S3_ENABLED=true
S3_ENDPOINT=https://s3.subgamezone.com
S3_BUCKET=subby
S3_REGION=ap-southeast-1
S3_ACCESS_KEY_ID=        # .env only — rotate trước production (§1.1)
S3_SECRET_ACCESS_KEY=    # .env only
S3_PREFIX=user_att/
S3_PRESIGN_TTL_SECONDS=900
```

Dependency: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

### 2.4 File mới

`src/infrastructure/storage/s3.ts` — ở `infrastructure/` để tuân rule
[`infra-no-modules`](.dependency-cruiser.cjs:11).

```ts
putUserAttachment(input: { key: string; body: Buffer; contentType: string }): Promise<void>
presignUserAttachment(key: string, ttlSeconds?: number): Promise<string>
deleteUserAttachment(key: string): Promise<void>
```

### 2.5 Key scheme — content-addressed

```
user_att/<guildId>/<discordUserId>/<yyyy>/<mm>/<kind>-<sha256[0..16]>.jpg
kind = order | device | steam
```

sha256 của **bytes ảnh** làm tên file → upload lại cùng ảnh là idempotent, dedupe miễn phí, đồng thời
là khoá cache OCR (§5.1) và tín hiệu chống gian lận (`duplicate_bill`, §7 Step 5).

### 2.6 Bảo mật + retention

- Bucket **private**. Không bật public read trên `user_att/`.
- Chỉ trả ảnh qua **presigned GET TTL 15 phút**. Không nhét URL trần vào embed.
- Ảnh là screenshot **toàn màn hình** — chứa tab riêng tư, tin nhắn, tên thật. Dữ liệu cá nhân:
  - `order` / `device` (bằng chứng signup): giữ tới hết hạn gói + 90 ngày
  - `steam` (mỗi lần xin mã): **xoá sau 30 ngày**
  - Sweeper gắn vào [`jobs/scheduler.ts`](src/modules/jobs/scheduler.ts) cạnh sweeper `steam-code-cache`
- Ảnh mẫu hướng dẫn (§11): prefix riêng `guide/`, public read được — tách hẳn khỏi `user_att/`.

---

## 3. Config

```
# OCR
OCR_ENABLED=true
OCR_BASE_URL=https://cheapkeyai.shop/v1
OCR_MODEL=gemini-2.5-flash-lite
OCR_API_KEY=                                   # .env only — rotate (§1.1)
OCR_TIMEOUT_MS=45000
OCR_MAX_OUTPUT_TOKENS=700

# Code access
CODE_ACCESS_ISSUE_CODES=true
CODE_ACCESS_REQUEST_DAILY_LIMIT=5
CODE_ACCESS_SCREENSHOT_MAX_AGE_MINUTES=30
CODE_ACCESS_OS_POLICY=warn                     # warn -> suspend sau 1-2 tuần (§4.4)
CODE_ACCESS_ESCALATE_BELOW=0.80                # confidence dưới ngưỡng -> gọi admin (§6)
CODE_ACCESS_AUTO_APPROVE_ABOVE=0.90            # trên ngưỡng -> tự duyệt (§6)
SUPPORT_FANPAGE_URL=https://www.facebook.com/subgamezoneoffical
```

Client OCR: `src/infrastructure/ocr/client.ts`, dùng `ChatOpenAI` như
[agent/llm.ts](src/modules/agent/llm.ts) nhưng baseURL/key riêng. **Không** tái dùng
`getPlannerModel()` — khác provider, khác key.

---

## 4. Device fingerprint + chính sách Windows

### 4.1 Field đọc từ ảnh (Settings → System → About)

```ts
type WindowsDeviceInfo = {
  deviceName:   string | null;  // DESKTOP-LBNLFJG
  motherboard:  string | null;  // Z690 Pro RS
  processor:    string | null;  // 13th Gen Intel Core i5-13600K
  installedRam: string | null;  // 32.0 GB
  graphicsCard: string | null;  // NVIDIA GeForce RTX 3060 Ti
  storage:      string | null;  // 2.05 TB
  deviceId:     string | null;  // 665AD019-F585-4827-A162-9054B0BEABFA
  productId:    string | null;  // 00330-80000-00000-AA273
  systemType:   string | null;  // 64-bit
  osEdition:    string | null;  // Windows 11 Pro
  osVersion:    string | null;  // 25H2
  osBuild:      string | null;  // 26200.9168
  installedOn:  string | null;  // 2/20/2026
};
```

### 4.2 Thành phần vào hash

`fingerprintDevice` hiện tại ([fingerprint.ts:10](src/modules/code-access/service/fingerprint.ts:10))
nhét **tất cả** field vào hash, kể cả `storage`/`installedRam` → user nâng RAM hoặc ổ cứng là bị
reject "sai máy". Sửa:

| Field | Vào hash | Lý do |
|---|---|---|
| `deviceId` | ✅ bậc 1 | GUID duy nhất — có nó thì hash chỉ cần nó |
| `productId` | ✅ bậc 2 | định danh Windows license |
| `deviceName` | ✅ bậc 2 | |
| `motherboard` | ✅ bậc 2 | đổi main = đổi máy thật |
| `processor` | ✅ bậc 2 | |
| `osVersion` | ❌ hash — **cột riêng** | §4.3 |
| `installedRam` `storage` `graphicsCard` `osBuild` `installedOn` | ❌ | thay đổi hợp pháp |

Khớp bậc: `deviceId` khớp → pass. OCR không đọc được `deviceId` → cần ≥3/4 field bậc 2 khớp.

### 4.3 Vì sao `osVersion` KHÔNG vào hash

Trộn vào hash thì mọi lỗi ra cùng thông báo "sai máy" — user nâng cấp Windows không hiểu vì sao mất
quyền. Tách riêng thì báo đúng nguyên nhân và đúng hướng xử lý.

### 4.4 Chính sách Windows Update

Yêu cầu: không được update Windows trừ bản vá bảo mật critical. Update phiên bản → huỷ đăng ký,
hướng dẫn mua lại gói.

Hai loại update khác hẳn nhau:

| Loại | Đổi gì | Xử lý |
|---|---|---|
| Bản vá bảo mật hằng tháng | chỉ `osBuild` (26200.9168 → 26200.9xxx), **cùng `osVersion`** | ✅ cho phép, chỉ ghi log |
| Feature update / nâng phiên bản | `osVersion` đổi (25H2 → 26H1) | ⛔ vi phạm |

→ Chỉ khoá `osVersion`, **không** khoá `osBuild`. Khoá build thì 1 tháng sau user hết lấy được mã dù
không làm gì sai.

**`CODE_ACCESS_OS_POLICY` — lộ trình đã chốt:**

```
Giai đoạn 1 (1–2 tuần đầu)  = warn
  osVersion khác  → VẪN phát mã
                  → ghi writeAudit('code_access.os_mismatch') với cả 2 giá trị + confidence
                  → gửi thẻ thống kê cho admin (không cần hành động)
  Mục đích: đo tỉ lệ OCR đọc sai osVersion trên ảnh thật trước khi bật chặn.

Giai đoạn 2 (sau khi số liệu ổn) = suspend
  confidence >= CODE_ACCESS_ESCALATE_BELOW  → slot.status='suspended',
                                              suspend_reason='os_upgraded'
                                            → embed §4.5, user mất quyền, guide mua lại
  confidence <  CODE_ACCESS_ESCALATE_BELOW  → KHÔNG tự quyết → escalate admin (§6)
```

Không bao giờ dùng `revoke` tự động. Lý do: OCR đọc nhầm "25H2" thành "26H2" trên ảnh mờ là chuyện
có thật; `revoke` là không hoàn tác được từ phía user, và họ sẽ tin là bot hỏng chứ không tin mình sai.
`suspend` cho user **cùng trải nghiệm** (mất quyền ngay, được guide mua lại) nhưng admin cứu được.
`/code-admin rebind` là đường cứu.

**Rà số liệu giai đoạn 1** — sau 2 tuần, query:

```sql
select details->>'ocr_os', details->>'locked_os', (details->>'confidence')::real
from audit where action = 'code_access.os_mismatch' order by created_at desc;
```

Tỉ lệ mismatch mà confidence cao → là user nâng cấp thật, bật `suspend` được.
Tỉ lệ cao ở confidence thấp → prompt OCR cần sửa trước, chưa bật.

### 4.5 Embed khi phát hiện nâng cấp (giai đoạn 2)

```
⛔ Máy này đã nâng cấp Windows

Phiên bản lúc đăng ký : Windows 11 Pro 25H2
Phiên bản hiện tại    : Windows 11 Pro 26H1

Theo điều khoản sử dụng, nâng cấp phiên bản Windows làm mất hiệu lực kích hoạt.
Đăng ký của máy này đã bị huỷ, bạn cần mua lại gói mới.

(Bản vá bảo mật hằng tháng KHÔNG ảnh hưởng — chỉ nâng phiên bản mới bị.)

[🛒 Mua gói mới]  [💬 Nhắn fanpage nếu bạn cho là nhầm lẫn]
```

---

## 5. Lớp OCR

`src/modules/code-access/ocr/`: `types.ts` · `prompt.ts` · `client.ts` · `cache.ts` · `index.ts`.

### 5.1 Tiết kiệm token (yêu cầu bắt buộc)

1. **1 call cho cả 2 ảnh** ở signup. Prompt chỉ rõ "image 1 = order, image 2 = device".
2. **JSON-only**: `Return only a JSON object matching this schema. No prose, no markdown fence.`
   Bỏ mảng `reasons: string[]` dài dòng của
   [verification/prompt.ts:10](src/modules/code-access/verification/prompt.ts:10) → thay bằng
   `flags: string[]` enum cố định (`cropped` `no_clock` `edited` `unreadable` `no_steam_prompt`),
   code map sang tiếng Việt. Model trả vài token thay vì vài trăm.
3. `max_tokens = 700`, `temperature: 0`.
4. **Downscale trước khi gửi**: `sharp` resize cạnh dài 1280px, JPEG q80, base64 data URL.
   Giảm tile count Gemini ≈40% mà vẫn đọc được Device ID. `sharp` dùng chung cho cả nén trước khi lên S3.
   → là native dep, phải thêm vào [Dockerfile](Dockerfile) (`libvips`; hoặc dùng base image
   `node:20-bookworm-slim` thay `alpine` để tránh build sharp từ nguồn).
5. **Cache theo sha256** (§8.4). User submit lại cùng ảnh (rất hay xảy ra khi sửa field) → 0 token.
6. **Sửa field không gọi lại OCR** — modal edit chỉ ghi `payload_json`.
7. `/code request` OCR 1 ảnh (PC) hoặc 2 ảnh (handheld); **không OCR lại bill**.

### 5.2 Pipeline ảnh (dùng chung signup + request)

```
Discord attachment
  → tải bytes (1 lần)
  → sha256(bytes)            -- khoá cache + tên file S3 + tín hiệu chống gian lận
  → sharp resize 1280 / jpeg q80
  → [song song] putUserAttachment(S3)  +  OCR base64
  → lưu s3_key + sha256 vào DB
```

---

## 6. Escalate admin khi confidence thấp (mới)

Luồng mặc định tự quyết. Nhưng **không tự quyết khi không chắc** — thà hỏi admin còn hơn từ chối oan
một khách đã trả tiền, hoặc duyệt nhầm một bill giả.

### 6.1 Ba vùng quyết định

```
confidence >= CODE_ACCESS_AUTO_APPROVE_ABOVE (0.90)   → tự duyệt
CODE_ACCESS_ESCALATE_BELOW (0.80) .. 0.90             → tự duyệt, nhưng ghi audit để rà lại
confidence <  CODE_ACCESS_ESCALATE_BELOW (0.80)       → ESCALATE, không tự quyết
```

Escalate cũng kích hoạt khi có flag mâu thuẫn: `duplicate_bill` · `order_reused` · `device_shared`
(3 cái này **không bao giờ** tự duyệt dù confidence cao — chúng là dấu hiệu gian lận, cần người xem).

### 6.2 Bảng `code_access_escalations`

```
id            uuid pk
guild_id / user_id
kind          varchar(24)   -- 'signup_low_conf' | 'os_mismatch' | 'request_low_conf' | 'fraud_flag'
slot_id       uuid null     -- có khi escalate lúc request
draft_id      uuid null     -- có khi escalate lúc signup
payload_json  jsonb         -- OCR result + điều kiện nào fail + confidence
evidence_keys text[]        -- S3 key ảnh bằng chứng
status        varchar(16)   -- 'open' | 'approved' | 'rejected' | 'expired'
admin_msg_id  varchar(32)   -- message thẻ admin, để edit sau khi quyết
decided_by / decided_at
created_at · expires_at     -- 48h, hết thì tự 'expired' + báo user
index (guild_id, status, created_at)
```

### 6.3 Gửi cho admin ở đâu

Dùng `guild_settings.modLogChannelId` + `modRoleId`
([discord.ts:9-10](src/modules/database/schema/discord.ts:9)) — đã cấu hình được qua
`/ai-config support`, và [approval-buttons.ts](src/modules/discord/components/approval-buttons.ts)
đã dùng pattern này.

```
1. modLogChannelId có → gửi thẻ vào đó, ping <@&modRoleId> nếu có
2. không có → DM thẳng config.ADMIN_DISCORD_ID
3. cả hai fail → ghi audit + báo user "đang chờ admin, liên hệ fanpage nếu quá 24h"
```

### 6.4 Thẻ quyết định cho admin

```
🔍 Cần admin xác nhận — độ tin cậy 62%

Người dùng   <@id> (`username`)
Lý do        OCR không chắc mã đơn hàng và ngày mua
Gói          1 tháng (OCR đọc được)
Máy          DESKTOP-LBNLFJG · 665AD019-F585-…
Windows      25H2 (build 26200.9168)
Cảnh báo     ảnh hơi mờ; không thấy đồng hồ

[🖼️ Xem ảnh bill]  [🖼️ Xem ảnh máy]     <- sinh presigned URL lúc bấm, TTL 15 phút
[✅ Duyệt]  [⛔ Từ chối]  [✏️ Sửa rồi duyệt]
```

- 2 nút ảnh sinh presigned URL **lúc bấm**, không lưu URL trong message.
- `[✏️ Sửa rồi duyệt]` mở modal cho admin sửa field OCR đọc sai rồi duyệt luôn — ca hay gặp nhất.
- Chỉ `isAdminMember` bấm được. Sau khi quyết, edit message thành trạng thái cuối (pattern
  `processedRows()` ở [approval-buttons.ts:58](src/modules/discord/components/approval-buttons.ts:58)).

### 6.5 Người dùng thấy gì trong lúc chờ

```
🕐 Đang chờ admin xác nhận

Ảnh của bạn hơi khó đọc nên mình cần admin xem qua.
Thường mất vài phút đến vài giờ. Mình sẽ nhắn lại ngay khi có kết quả.

Muốn nhanh hơn? [🔁 Chụp lại ảnh rõ hơn]  [💬 Nhắn fanpage]
```

Nút `[🔁 Chụp lại]` vẫn mở — user chụp lại ảnh rõ, đạt confidence cao thì tự duyệt luôn và
escalation tự đóng. Không bắt user ngồi chờ nếu họ tự sửa được.

Có kết quả → bot DM user (fallback: reply trong channel gốc nếu DM đóng).

---

## 7. Luồng `/code signup`

Discord **không** cho gửi attachment từ button/modal — chỉ slash command có attachment option.
Hybrid: signature có attachment optional, thiếu thì thu bằng message collector.

```
/code signup [purchase_proof: attachment] [device_info: attachment]
```

```
Step 0  → lần đầu dùng bot: gắn embed hướng dẫn đầy đủ + CẢNH BÁO §10
        → đã có slot: "Bạn đang có N gói" + [➕ Đăng ký thêm gói] [📋 Gói của tôi]
          (KHÔNG chặn — user được mua nhiều gói cho nhiều máy)

Step 1  "Bạn đã mua tài khoản chưa?"   [✅ Đã mua]  [🛒 Chưa mua]

Step 2a [Chưa mua] → embed + Link button
          https://subgamezone.com/products/tai-khoan-steam-offline-nhieu-games
        → 3 thứ cần chuẩn bị:
          1. Ảnh lịch sử đơn hàng (web hoặc tin nhắn có bill)
          2. Ảnh FULL màn hình Settings → System → About, rõ đồng hồ + ngày + dòng Version
          3. Biết gói mình mua: 1 tháng / 1 năm / vĩnh viễn
        → **kèm CẢNH BÁO §10 tại đây** (phải update xong TRƯỚC khi signup)
        → [🔄 Tôi đã mua xong] → Step 2b

Step 2b [Đã mua]
        → đủ 2 attachment từ Step 0 → Step 3
        → thiếu → tạo draft (step='await_images') + embed hướng dẫn chụp (ảnh mẫu §11)
          → message collector: cùng user, cùng channel, ≥1 image; 10 phút; max 2 message
          → timeout: nhắc chạy lại `/code signup purchase_proof:<file> device_info:<file>`

Step 3  isSafeImage (đã có, format.ts:5) · ≤5MB · image/* · hitCodeAccessDailyLimit (đã có)
        deferReply ephemeral

Step 4  Pipeline ảnh §5.2 → cache check → OCR 1 call

Step 5  Chống gian lận (deterministic, 0 token):
          purchase_proof_sha256 tồn tại ở user khác   → duplicate_bill   ⚠️ escalate luôn
          order_code đã gắn Discord id khác           → order_reused     ⚠️ escalate luôn
          fingerprint_hash đã tồn tại                 → device_shared    ⚠️ escalate luôn
          đồng hồ ảnh lệch > SCREENSHOT_MAX_AGE       → stale_shot
          fullScreenVisible = false                   → cropped
          thiếu deviceId VÀ productId                 → weak_fingerprint
          không đọc được osVersion                    → no_os_version (bắt buộc, vì §4.4)

Step 6  Embed xác nhận (§9) + [✅ Đúng] [✏️ Cần sửa] [❌ Hủy]

Step 7  [✏️ Cần sửa] → StringSelect chọn field
          order_code · order_placed_at · plan_kind · plan_units ·
          device_name · device_id · product_id · processor · os_version
        → Modal 1 TextInput prefill → ghi payload_json
        → **edit chính message embed** (không gửi mới) → về Step 6

Step 8  [✅ Đúng] — 3 nhánh theo §6.1:
        confidence ≥ 0.90, không flag gian lận, đủ field bắt buộc:
          → tính subscription_start/end (lifetime → end = NULL;
            phải sửa entitlement.ts:116 vì hiện tại null bị coi là hết hạn)
          → upsert device + tạo slot, bind device_id, ghi os_version_locked
          → status='approved' · writeAudit('code_access.signup') · xoá draft
          → embed kết quả + CẢNH BÁO §10 + [📖 Cách lấy mã]
        confidence < 0.80 HOẶC có flag gian lận:
          → tạo escalation (§6), embed chờ §6.5. KHÔNG tạo slot.
        thiếu field bắt buộc:
          → nêu ĐÚNG field nào thiếu + [🔁 Chụp lại] [✏️ Nhập tay] [💬 Nhắn fanpage]
          → KHÔNG tạo slot. Draft giữ 15 phút để không mất dữ liệu đã nhập.
```

---

## 8. Schema DB (migration `drizzle/0009_code_access_slots.sql`)

Unique hiện tại `(guild_id, user_id, steam_username)`
([code-access.ts:21](src/modules/database/schema/code-access.ts:21)) chặn user mua 2 gói → tách 2 bảng.

### 8.1 `code_access_devices`

```
id                    uuid pk
guild_id / user_id    varchar(32)
fingerprint_hash      varchar(64)   not null
device_json           jsonb         not null
device_type           varchar(16)   -- 'pc' | 'handheld'
os_edition            varchar(64)   -- 'Windows 11 Pro'
os_version_locked     varchar(32)   -- '25H2'       <- khoá chính sách §4.4
os_build_at_signup    varchar(32)   -- tham chiếu, KHÔNG khoá
device_info_s3_key    text
device_info_sha256    varchar(64)
first_seen_at / last_verified_at / created_at / updated_at

unique (fingerprint_hash)            -- 1 máy vật lý = 1 user, TOÀN CỤC (đã chốt)
index  (guild_id, user_id)
```

### 8.2 `code_access_slots` (thay `code_access_entitlements`)

```
id                    uuid pk
guild_id / user_id
discord_username      varchar(64)   -- snapshot lúc signup
steam_username        varchar(128)
device_id             uuid -> code_access_devices.id
status                varchar(16)   -- 'approved' | 'suspended' | 'revoked' | 'expired'
suspend_reason        varchar(32)   -- 'os_upgraded' | 'fraud_suspected' | null
order_code            varchar(64)   -- '#2398', nullable (bill messenger)
order_placed_at       timestamptz
order_source          varchar(32)   -- 'web' | 'messenger' | 'other'
order_total_text      varchar(64)
product_name          text
plan_kind             varchar(16)   -- 'month' | 'year' | 'lifetime'
plan_units            integer       -- lifetime -> null
subscription_start    timestamptz
subscription_end      timestamptz   -- lifetime -> null
purchase_proof_s3_key text
purchase_proof_sha256 varchar(64)
ocr_json              jsonb
ocr_confidence        real
last_code_issued_at   timestamptz
onboarded_at          timestamptz
created_at / updated_at

unique (device_id)                                          -- 1 máy phục vụ 1 gói
unique (guild_id, order_code) where order_code is not null  -- 1 đơn dùng 1 lần
index  (guild_id, user_id, steam_username)
index  (purchase_proof_sha256)
index  (subscription_end)
```

Bỏ `pending` khỏi enum — hàng chờ nằm ở `code_access_escalations`, không ở slot.

### 8.3 `code_access_drafts`

Cần vì Discord `customId` tối đa 100 ký tự, không nhét nổi payload; và có modal sửa field.

```
id uuid pk · guild_id · user_id
kind          varchar(16)  -- 'signup' | 'request'
step          varchar(32)  -- 'await_images' | 'confirm' | 'editing'
payload_json  jsonb
message_id    varchar(32)  -- message chứa embed confirm, để edit tại chỗ
expires_at    timestamptz  -- now() + 15 phút
created_at / updated_at
unique (guild_id, user_id, kind)
index  (expires_at)
```

### 8.4 `code_access_ocr_cache`

```
sha256_key  varchar(64) pk   -- sha256(sha256(img1)+sha256(img2)+promptVersion)
result_json jsonb
created_at  timestamptz      -- TTL 7 ngày, sweeper
```

### 8.5 `code_access_escalations` — §6.2

### 8.6 Migration dữ liệu cũ

Chạy `select count(*) from code_access_entitlements` **trước khi viết migration**. Rỗng
(`CODE_ACCESS_ENABLED=false` mặc định → có thể chưa ai dùng) → drop, tạo mới cho gọn. Có dữ liệu →
backfill 1 entitlement → 1 device + 1 slot.

---

## 9. Embed xác nhận

```
Title : 🧾 Xác nhận thông tin đăng ký          Color: 0xfee75c

👤 Discord      <@id> (`username`) · id: 123456789
🧾 Mã đơn hàng  #2398                    (— nếu không đọc được)
📅 Ngày mua     2026-09-02 13:51
📦 Sản phẩm     Tài khoản Steam Offline 2000+ Games
⏳ Gói          1 tháng → hết hạn 2026-10-02
💻 Tên máy      DESKTOP-LBNLFJG
🆔 Device ID    665AD019-F585-4827-A162-9054B0BEABFA
🔑 Product ID   00330-80000-00000-AA273
⚙️ Cấu hình     i5-13600K · 32 GB · RTX 3060 Ti
🪟 Windows      Windows 11 Pro 25H2 (build 26200.9168)
                🔒 Phiên bản 25H2 sẽ bị KHOÁ — nâng cấp = mất gói
📊 Độ tin cậy   92%
⚠️ Cảnh báo     (chỉ hiện khi có flag)

Footer: Sai thông tin? Bấm "Cần sửa". Hết hạn sau 15 phút.
```

Field không đọc được → `—`. Nút `[✅ Đúng]` **disabled** khi thiếu bắt buộc: `plan_kind`,
`device_name`, `os_version`, và (`device_id` **hoặc** `product_id`).

`maskDeviceLabel` ([format.ts:19](src/modules/discord/commands/code-access/format.ts:19)) hiện chỉ cắt
độ dài → nâng thành mask giữa cho `deviceId`/`productId` khi hiển thị ngoài ephemeral.

---

## 10. ⚠️ Cảnh báo bắt buộc trước khi đăng ký

Xuất hiện ở **Step 2a của signup** (trước khi user chụp ảnh) và ở embed kết quả signup. Màu đỏ.

```
⚠️ LÀM XONG 3 VIỆC NÀY TRƯỚC KHI ĐĂNG KÝ

1. Cập nhật đầy đủ Windows Update
   Settings → Windows Update → Check for updates, chạy tới khi báo "You're up to date"
2. Cập nhật driver card màn hình
   NVIDIA app / AMD Adrenalin / Intel Driver & Support Assistant
3. Khởi động lại máy

Sau khi đăng ký xong, KHÔNG được nâng cấp phiên bản Windows nữa (vd 25H2 → 26H1).
Phiên bản của bạn sẽ bị khoá tại thời điểm đăng ký.
Nâng cấp phiên bản → mất kích hoạt → phải MUA LẠI GÓI MỚI.

✅ Bản vá bảo mật hằng tháng vẫn cài bình thường (chỉ đổi số build, không đổi phiên bản).
⛔ Feature update / "Get the latest updates as soon as they're available" → TẮT đi.
```

Thứ tự quan trọng: update **trước** rồi mới signup. Vì `os_version_locked` ghi lúc signup — cảnh báo
sau khi xong thì user update xong là bị chính cái khoá đó chặn.

---

## 11. Luồng `/code request <username>`

```
Step 0  → CODE_ACCESS_ENABLED? isAllowedCodeAccessAccount? (đã có)
        → không có slot → "Bạn cần đăng ký trước" + hướng dẫn gõ `/code signup`
          (button KHÔNG chạy được slash command — hiện hướng dẫn thật, không nút giả)
        → slot của account khác → liệt kê account user đang sở hữu
        → hết hạn → hạn + link gia hạn
        → suspended (os_upgraded) → embed §4.5
        → revoked → [💬 Nhắn fanpage]
        → có escalation đang 'open' → embed chờ §6.5

Step 1  "Bạn đang dùng thiết bị gì?"  [🖥️ PC / Laptop]  [🎮 Handheld]

Step 2a PC → 1 ảnh FULL màn hình thấy đồng thời:
             • cửa sổ Steam đang hỏi mã (như ảnh mẫu 1)
             • Settings → System → About, rõ dòng Version
             • đồng hồ + ngày trên taskbar

Step 2b Handheld → 2 ảnh riêng (handheld khó mở song song 2 cửa sổ):
             • ảnh 1: màn hình đăng nhập Steam
             • ảnh 2: thông tin máy
           Cả 2 rõ giờ + ngày.

Step 3  message collector, TTL 10 phút.

Step 4  hitCodeAccessDailyLimit(CODE_ACCESS_REQUEST_DAILY_LIMIT) → pipeline ảnh §5.2 → OCR.
        Trích: fingerprint · osVersion · đồng hồ trong ảnh · steamLoginPromptVisible: boolean

Step 5  Tra ngược BẰNG FINGERPRINT, không bằng username:
          fingerprint_hash → code_access_devices → slot đã bind
        Check:
          ✅ device tồn tại và thuộc đúng user_id      (sai → "máy này chưa đăng ký")
          ✅ slot.steam_username == username yêu cầu   (sai → "máy này gắn account khác")
          ✅ slot.status = 'approved'
          ✅ subscription còn hạn (hoặc lifetime)
          ✅ osVersion == os_version_locked            (theo policy §4.4)
          ✅ steamLoginPromptVisible = true
          ✅ đồng hồ ảnh cách now() ≤ SCREENSHOT_MAX_AGE_MINUTES
        confidence < 0.80 → KHÔNG tự từ chối → escalate (§6)
        Fail rõ ràng (confidence cao) → nêu ĐÚNG điều kiện nào fail
                                      + [🔁 Chụp lại] [💬 Nhắn fanpage]

Step 6  Pass → findLatestSteamCodeWithCache(account)
          (tái dùng nguyên src/modules/code-access/steam-code-cache.ts — đúng đường
           /code-admin đang dùng, admin.ts:62)
        → trả mã EPHEMERAL + cảnh báo mã hết hạn nhanh
        → update slot.last_code_issued_at, device.last_verified_at
        → writeAudit('code_access.code_issued')
        → mã KHÔNG vào log (giữ redactCodeAccessLogValue)
```

Tra bằng fingerprint thay vì username giải quyết gọn ca user nhiều máy: máy nào ra slot đó, user
không phải tự nhớ máy nào gắn account nào.

---

## 12. Routing interaction — thay đổi hạ tầng

[interaction-create.ts:55](src/modules/discord/events/interaction-create.ts:55) hiện **chỉ** route
button, không route select menu và modal. Phải thêm:

```ts
if (interaction.isStringSelectMenu() && interaction.customId.startsWith(CA_PREFIX)) …
if (interaction.isModalSubmit()      && interaction.customId.startsWith(CA_PREFIX)) …
if (interaction.isButton()           && interaction.customId.startsWith(CA_PREFIX)) …
```

customId (< 100 ký tự; uuid = 36):

```
ca:sg:bought:<draftId>    ca:sg:notbought:<draftId>  ca:sg:retry:<draftId>
ca:sg:ok:<draftId>        ca:sg:edit:<draftId>       ca:sg:cancel:<draftId>
ca:sg:field:<draftId>     (select)   ca:sg:modal:<draftId>:<field>
ca:rq:pc:<draftId>        ca:rq:hh:<draftId>         ca:rq:retry:<draftId>
ca:es:ok:<escId>          ca:es:no:<escId>           ca:es:fix:<escId>
ca:es:img:<escId>:<slot>  ca:help:<topic>
```

File mới: `commands/code-access/components.ts` (builder row/embed) ·
`commands/code-access/interactions.ts` (handler theo prefix) · `commands/code-access/escalation.ts`.
Giữ `code-access.ts` làm barrel — quy tắc "không đổi import path" của [CODEX-TASKS.md](CODEX-TASKS.md).

**Chống chiếm quyền:** handler user check `interaction.user.id === draft.user_id`; handler escalation
check `isAdminMember`. Pattern có sẵn ở
[approval-buttons.ts:90](src/modules/discord/components/approval-buttons.ts:90).

---

## 13. Onboarding

- `onboarded_at` null → gắn embed hướng dẫn đầy đủ + cảnh báo §10 vào response đầu tiên, set cột sau khi gửi.
- Mọi embed có `[📖 Xem hướng dẫn đầy đủ]` (`ca:help:<topic>`) → ephemeral embed dài; embed chính luôn ngắn.
- 3 ảnh mẫu bạn gửi: upload S3 prefix `guide/` **1 lần**, URL cố định, hardcode vào `GUIDE_IMAGES`.
  Đừng đính kèm file mỗi lần trả lời.
- Hướng dẫn chụp: `Settings → System → About`, chụp **toàn màn hình** (`PrtSc`, không dùng Snipping
  Tool cắt vùng), phải thấy đồng hồ taskbar **và** dòng `Version`.
- Mọi chỗ trước đây ghi "nhờ admin" → Link button
  **[💬 Nhắn fanpage](https://www.facebook.com/subgamezoneoffical)**.

---

## 14. 🕐 HOÃN — hỗ trợ DM

Không làm vòng này. Ghi lại để không mất context khi quay lại.

Cần khi làm:
- [client.ts:8](src/infrastructure/discord/client.ts:8) thêm `GatewayIntentBits.DirectMessages`
  và `Partials.Channel` (**bắt buộc**, không có thì event DM không bắn).
- `setDMPermission` đã deprecated ở discord.js 14.16 → dùng
  `.setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)`.
- `guildId` là `null` trong DM. Có **138 chỗ** dùng `guildId` trên **15 file** — không sửa hết, chỉ
  thêm helper `resolveScope()` trong code-access, fallback về `config.DISCORD_GUILD_ID` để hồ sơ
  thống nhất giữa guild và DM.
- Rate limit key ([limits.ts:35](src/modules/code-access/limits.ts:35)) phải theo scope đã resolve,
  không thì user lách limit bằng cách chuyển sang DM.
- `/code-admin` giữ guild-only — `isAdminMember` đọc `interaction.member`, DM là `null`.
- Bot chỉ DM được nếu user mở DM; xử lý `50007 Cannot send messages to this user`.

Lý do đáng làm sau: ảnh là screenshot toàn màn hình, DM riêng tư hơn channel công khai nhiều.

---

## 15. 🕐 HOÃN — Payload admin

Không làm vòng này. Ghi lại kết luận khảo sát để khỏi làm lại:

**Vấn đề cốt lõi:** bot dùng Drizzle với 8 migration sẵn ([drizzle/](drizzle/)). Payload postgres
adapter **tự sinh và tự migrate schema**. Hai hệ migration trên 1 database = xung đột chắc chắn.

3 lựa chọn, đề xuất **C**:

| | Cách | Nhược chính |
|---|---|---|
| A | Payload trỏ DB bot, tắt migrate của Payload, `dbSchemaName: 'payload'` cho bảng nội bộ | Payload kén schema tự sinh; nâng cấp Payload có thể tự ý migrate |
| B | Payload sở hữu bảng code-access, Drizzle chỉ query | Đổi chiều sở hữu giữa chừng; tên cột do Payload đặt |
| **C** ⭐ | Payload service riêng + DB riêng, bot ghi Postgres của mình rồi đẩy sang async + retry | Thêm 1 service; nhưng signup/request **không bao giờ** chết theo Payload |

sgz đã là Payload 3 + cùng bucket S3 + Google auth sẵn — gộp vào sgz thì admin chỉ 1 chỗ đăng nhập,
nhưng Payload chỉ có **1 `DATABASE_URI`** nên dữ liệu bot sẽ nằm trong DB của web bán hàng.

Trong lúc hoãn, admin dùng `/code-admin` (§16) — đủ cho vận hành.

---

## 16. `/code-admin` mở rộng

```
/code-admin code    [username]                            -- như hiện tại, KHÔNG đụng
/code-admin grant   <user> <username> <plan> <device_id>  -- cấp tay khi OCR fail liên tục
/code-admin rebind  <user> <slot>                         -- xoá bind máy, cho signup lại 1 lần
/code-admin revoke  <user> <slot>                         -- thu hồi
/code-admin queue                                         -- liệt kê escalation đang 'open'
/code-admin stats                                         -- tỉ lệ os_mismatch, confidence, §4.4
```

Thay cho `/code review` bị xoá. `/code-admin stats` là công cụ để quyết định khi nào chuyển
`CODE_ACCESS_OS_POLICY` từ `warn` sang `suspend`.

---

## 17. Xoá / giữ

**Xoá:**
- `verify` ([definitions.ts:26](src/modules/discord/commands/code-access/definitions.ts:26)) +
  `handleVerify` ([handlers.ts:64](src/modules/discord/commands/code-access/handlers.ts:64))
- `review` ([definitions.ts:56](src/modules/discord/commands/code-access/definitions.ts:56)) +
  `handleReview` → chuyển sang `/code-admin`
- `deterministicVerificationFallback`
  ([verify.ts:73](src/modules/code-access/verification/verify.ts:73)) — parse ngày tháng từ **chuỗi
  URL**, là an toàn giả. OCR fail → escalate hoặc cho chụp lại, không đoán bừa
- Trạng thái `pending` trên slot (thay bằng `code_access_escalations`)

**Giữ (reuse):** `accounts.ts` · `limits.ts` · `safety.ts` · `steam-code-cache.ts` · `format.ts` ·
`permissions/guard.ts` · `database/audit.ts` · `shared/media.ts`

**Sửa nhỏ:** `entitlement.ts:116` (lifetime = `subscriptionEnd` null) · `fingerprint.ts` (§4.2)

---

## 18. Test

| File | Kiểm |
|---|---|
| `code-access-ocr.test.ts` | parse JSON: hợp lệ, thiếu field, có fence, rác → null |
| `code-access-ocr-cache.test.ts` | hit/miss, TTL 7 ngày |
| `code-access-s3.test.ts` | key scheme, presign TTL, không lộ URL trần |
| `code-access-drafts.test.ts` | TTL, unique 1 draft/user/kind, sweeper |
| `code-access-fraud.test.ts` | duplicate_bill · order_reused · device_shared → escalate, không auto-approve dù confidence cao |
| `code-access-fingerprint.test.ts` | deviceId khớp = pass; đổi RAM/ổ/GPU/build vẫn pass; đổi main = fail |
| `code-access-oslock.test.ts` | policy `warn` vẫn phát mã + ghi audit; `suspend` chặn; osBuild khác → **không** chặn |
| `code-access-escalation.test.ts` | 3 vùng confidence; escalation hết hạn 48h; user tự chụp lại thì escalation đóng |
| `code-access-slots.test.ts` | 1 user N gói N máy; 1 máy không nhận 2 gói; lifetime không hết hạn |
| `code-access-request.test.ts` | tra ngược bằng fingerprint ra đúng slot |
| `code-access-interactions.test.ts` | parse customId; user khác không bấm được nút; escalation chỉ admin bấm |

Sửa: `tests/code-access-verification.test.ts` · `tests/code-access-service.test.ts`

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

---

## 19. Thứ tự thực hiện

1. Config + `.env.example` + `sharp` + Dockerfile (libvips) + `infrastructure/storage/s3.ts` +
   `infrastructure/ocr/client.ts`. Smoke test: upload 1 ảnh `user_att/`, presign, đọc lại.
2. `select count(*) from code_access_entitlements` → quyết định drop hay backfill.
3. Migration 0009: `code_access_devices` · `code_access_slots` · `code_access_drafts` ·
   `code_access_ocr_cache` · `code_access_escalations`.
4. `ocr/*` + pipeline ảnh §5.2 + cache + test parse.
5. `fingerprint.ts` (§4.2) + `os_version_locked` + `entitlement.ts` lifetime + test.
6. Routing interaction (button/select/modal) + `components.ts`.
7. `/code signup` end-to-end với 3 vùng confidence.
8. Escalation §6: bảng + thẻ admin + modal sửa + thông báo user.
9. `/code request` + phát mã + 7 gate §1.2.
10. `/code status` cho N gói/N máy · `/code-admin grant|rebind|revoke|queue|stats`.
11. Chạy `CODE_ACCESS_OS_POLICY=warn` 1–2 tuần → đọc `/code-admin stats` → chuyển `suspend`.
12. Xoá `verify`/`review`/`deterministicVerificationFallback`, cập nhật README,
    `npm run register:commands`.

**Sau này (đã hoãn):** DM (§14) · Payload admin (§15).
