CREATE TABLE IF NOT EXISTS "code_access_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "fingerprint_hash" varchar(64) NOT NULL,
  "device_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "device_type" varchar(16) DEFAULT 'pc' NOT NULL,
  "os_edition" varchar(64),
  "os_version_locked" varchar(32),
  "os_build_at_signup" varchar(32),
  "device_info_s3_key" text,
  "device_info_sha256" varchar(64),
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "code_access_devices_fingerprint_idx" ON "code_access_devices" ("fingerprint_hash");
CREATE INDEX IF NOT EXISTS "code_access_devices_user_idx" ON "code_access_devices" ("guild_id", "user_id");
CREATE INDEX IF NOT EXISTS "code_access_devices_product_expr_idx" ON "code_access_devices" (lower(regexp_replace(coalesce("device_json"->>'productId', ''), '[^a-zA-Z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "code_access_devices_name_expr_idx" ON "code_access_devices" (lower(regexp_replace(coalesce("device_json"->>'deviceName', ''), '[^a-zA-Z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "code_access_devices_board_expr_idx" ON "code_access_devices" (lower(regexp_replace(coalesce("device_json"->>'motherboard', ''), '[^a-zA-Z0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "code_access_devices_cpu_expr_idx" ON "code_access_devices" (lower(regexp_replace(coalesce("device_json"->>'processor', ''), '[^a-zA-Z0-9]', '', 'g')));

CREATE TABLE IF NOT EXISTS "code_access_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "discord_username" varchar(64) NOT NULL,
  "steam_username" varchar(128) NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "code_access_devices"("id"),
  "status" varchar(16) DEFAULT 'approved' NOT NULL,
  "suspend_reason" varchar(32),
  "order_code" varchar(64),
  "order_placed_at" timestamp with time zone,
  "order_source" varchar(32),
  "order_total_text" varchar(64),
  "product_name" text,
  "plan_kind" varchar(16) NOT NULL,
  "plan_units" integer,
  "subscription_start" timestamp with time zone NOT NULL,
  "subscription_end" timestamp with time zone,
  "purchase_proof_s3_key" text,
  "purchase_proof_sha256" varchar(64),
  "ocr_json" jsonb,
  "ocr_confidence" real,
  "last_code_issued_at" timestamp with time zone,
  "onboarded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "code_access_slots_device_idx" ON "code_access_slots" ("device_id");
CREATE UNIQUE INDEX IF NOT EXISTS "code_access_slots_order_idx" ON "code_access_slots" ("guild_id", "order_code") WHERE "order_code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "code_access_slots_user_steam_idx" ON "code_access_slots" ("guild_id", "user_id", "steam_username");
CREATE INDEX IF NOT EXISTS "code_access_slots_purchase_sha_idx" ON "code_access_slots" ("purchase_proof_sha256");
CREATE INDEX IF NOT EXISTS "code_access_slots_subscription_end_idx" ON "code_access_slots" ("subscription_end");

CREATE TABLE IF NOT EXISTS "code_access_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "step" varchar(32) NOT NULL,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "message_id" varchar(32),
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "code_access_drafts_user_kind_idx" ON "code_access_drafts" ("guild_id", "user_id", "kind");
CREATE INDEX IF NOT EXISTS "code_access_drafts_expiry_idx" ON "code_access_drafts" ("expires_at");

CREATE TABLE IF NOT EXISTS "code_access_ocr_cache" (
  "sha256_key" varchar(64) PRIMARY KEY NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "code_access_escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "kind" varchar(24) NOT NULL,
  "slot_id" uuid REFERENCES "code_access_slots"("id") ON DELETE SET NULL,
  "draft_id" uuid REFERENCES "code_access_drafts"("id") ON DELETE SET NULL,
  "payload_json" jsonb NOT NULL,
  "evidence_keys" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "admin_msg_id" varchar(32),
  "decided_by" varchar(32),
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "code_access_escalations_status_idx" ON "code_access_escalations" ("guild_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "code_access_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "slot_id" uuid REFERENCES "code_access_slots"("id") ON DELETE SET NULL,
  "kind" varchar(16) NOT NULL,
  "s3_key" text NOT NULL,
  "sha256" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "code_access_evidence_s3_key_idx" ON "code_access_evidence" ("s3_key");
CREATE INDEX IF NOT EXISTS "code_access_evidence_expiry_idx" ON "code_access_evidence" ("expires_at");

-- The implementation host could not authenticate to the configured database while
-- preparing this migration. Preserve any legacy data instead of assuming the old
-- table is empty. A generated fallback fingerprint is scoped to the legacy row.
DO $migration$
BEGIN
  IF to_regclass('public.code_access_entitlements') IS NOT NULL THEN
    CREATE TEMP TABLE code_access_legacy_map ON COMMIT DROP AS
    SELECT
      e.id,
      CASE
        WHEN e.device_fingerprint_hash IS NOT NULL AND e.device_fingerprint_hash <> ''
          AND count(*) OVER (PARTITION BY e.device_fingerprint_hash) = 1
          THEN e.device_fingerprint_hash
        ELSE md5(e.id::text) || md5('legacy:' || e.id::text)
      END AS migrated_fingerprint,
      CASE
        WHEN e.device_fingerprint_hash IS NOT NULL AND e.device_fingerprint_hash <> ''
          AND count(*) OVER (PARTITION BY e.device_fingerprint_hash) > 1
          THEN true ELSE false
      END AS duplicate_legacy_device
    FROM code_access_entitlements e;

    INSERT INTO code_access_devices (
      guild_id, user_id, fingerprint_hash, device_json, os_version_locked,
      first_seen_at, last_verified_at, created_at, updated_at
    )
    SELECT
      e.guild_id,
      e.user_id,
      m.migrated_fingerprint,
      jsonb_build_object('legacyLabel', e.device_fingerprint_label, 'legacyDeviceInfoUrl', e.device_info_url),
      NULLIF(e.verification_json->>'osVersion', ''),
      e.created_at,
      e.reviewed_at,
      e.created_at,
      e.updated_at
    FROM code_access_entitlements e
    JOIN code_access_legacy_map m ON m.id = e.id
    ON CONFLICT (fingerprint_hash) DO NOTHING;

    INSERT INTO code_access_slots (
      guild_id, user_id, discord_username, steam_username, device_id, status, suspend_reason,
      plan_kind, plan_units, subscription_start, subscription_end, ocr_json,
      ocr_confidence, created_at, updated_at
    )
    SELECT
      e.guild_id,
      e.user_id,
      'legacy-' || left(e.user_id, 56),
      e.steam_username,
      d.id,
      CASE WHEN m.duplicate_legacy_device THEN 'suspended'
           WHEN e.status = 'approved' THEN 'approved'
           WHEN e.status = 'revoked' THEN 'revoked'
           ELSE 'suspended' END,
      CASE WHEN m.duplicate_legacy_device THEN 'fraud_suspected'
           WHEN e.status NOT IN ('approved', 'revoked') THEN 'legacy_review'
           ELSE NULL END,
      CASE WHEN e.subscription_end IS NULL THEN 'lifetime' ELSE 'month' END,
      CASE WHEN e.subscription_end IS NULL THEN NULL ELSE 1 END,
      COALESCE(e.subscription_start, e.created_at),
      e.subscription_end,
      COALESCE(e.verification_json, '{}'::jsonb) || jsonb_build_object('legacyPurchaseProofUrl', e.purchase_proof_url),
      CASE WHEN (e.verification_json->>'confidence') ~ '^[0-9.]+$'
           THEN (e.verification_json->>'confidence')::real ELSE NULL END,
      e.created_at,
      e.updated_at
    FROM code_access_entitlements e
    JOIN code_access_legacy_map m ON m.id = e.id
    JOIN code_access_devices d ON d.fingerprint_hash = m.migrated_fingerprint
    ON CONFLICT (device_id) DO NOTHING;

    DROP TABLE code_access_entitlements;
  END IF;
END $migration$;
