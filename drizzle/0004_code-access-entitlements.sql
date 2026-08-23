CREATE TABLE IF NOT EXISTS "code_access_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guild_id" varchar(32) NOT NULL,
  "user_id" varchar(32) NOT NULL,
  "steam_username" varchar(128) NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "subscription_start" timestamp with time zone,
  "subscription_end" timestamp with time zone,
  "device_fingerprint_hash" varchar(64),
  "device_fingerprint_label" text,
  "purchase_proof_url" text,
  "device_info_url" text,
  "verification_json" jsonb,
  "reviewed_by" varchar(32),
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "code_access_user_steam_idx"
  ON "code_access_entitlements" ("guild_id", "user_id", "steam_username");

CREATE INDEX IF NOT EXISTS "code_access_status_idx"
  ON "code_access_entitlements" ("guild_id", "status", "updated_at");

CREATE INDEX IF NOT EXISTS "code_access_steam_idx"
  ON "code_access_entitlements" ("guild_id", "steam_username");
