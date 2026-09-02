CREATE TABLE "code_access_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"fingerprint_hash" varchar(64) NOT NULL,
	"device_json" jsonb NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "code_access_drafts" (
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
--> statement-breakpoint
CREATE TABLE "code_access_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"slot_id" uuid,
	"draft_id" uuid,
	"payload_json" jsonb NOT NULL,
	"evidence_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"admin_msg_id" varchar(32),
	"decided_by" varchar(32),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_access_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"slot_id" uuid,
	"kind" varchar(16) NOT NULL,
	"s3_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_access_feedback_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"thread_id" varchar(32) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminder_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"penalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_access_ocr_cache" (
	"sha256_key" varchar(64) PRIMARY KEY NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_access_penalties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"reason" varchar(32) DEFAULT 'missing_feedback' NOT NULL,
	"banned_until" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_access_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"discord_username" varchar(64) NOT NULL,
	"steam_username" varchar(128) NOT NULL,
	"device_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "steam_code_mail_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gmail_message_id" varchar(128) NOT NULL,
	"steam_username" varchar(128) NOT NULL,
	"account_label" varchar(128) NOT NULL,
	"code" varchar(16) NOT NULL,
	"sender" text,
	"subject" text,
	"body_preview" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_response_snapshots" (
	"request_id" varchar(64) PRIMARY KEY NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"intent" varchar(16),
	"query_hash" varchar(64),
	"role_scope_hash" varchar(64),
	"cached" boolean DEFAULT false NOT NULL,
	"retrieved_chunks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"guild_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"opened_by_message_id" varchar(32) NOT NULL,
	"last_user_message_id" varchar(32) NOT NULL,
	"last_bot_message_id" varchar(32),
	"last_request_id" varchar(64),
	"opened_at" timestamp with time zone NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_limit_counts" (
	"scope_key" varchar(128) NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"hit_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "review_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "reviewed_by" varchar(32);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "cache_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "content_search" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "code_access_escalations" ADD CONSTRAINT "code_access_escalations_slot_id_code_access_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."code_access_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_access_escalations" ADD CONSTRAINT "code_access_escalations_draft_id_code_access_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."code_access_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_access_evidence" ADD CONSTRAINT "code_access_evidence_slot_id_code_access_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."code_access_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_access_slots" ADD CONSTRAINT "code_access_slots_device_id_code_access_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."code_access_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_devices_fingerprint_idx" ON "code_access_devices" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "code_access_devices_user_idx" ON "code_access_devices" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "code_access_devices_product_expr_idx" ON "code_access_devices" USING btree (lower(regexp_replace(coalesce("device_json"->>'productId', ''), '[^a-zA-Z0-9]', '', 'g')));--> statement-breakpoint
CREATE INDEX "code_access_devices_name_expr_idx" ON "code_access_devices" USING btree (lower(regexp_replace(coalesce("device_json"->>'deviceName', ''), '[^a-zA-Z0-9]', '', 'g')));--> statement-breakpoint
CREATE INDEX "code_access_devices_board_expr_idx" ON "code_access_devices" USING btree (lower(regexp_replace(coalesce("device_json"->>'motherboard', ''), '[^a-zA-Z0-9]', '', 'g')));--> statement-breakpoint
CREATE INDEX "code_access_devices_cpu_expr_idx" ON "code_access_devices" USING btree (lower(regexp_replace(coalesce("device_json"->>'processor', ''), '[^a-zA-Z0-9]', '', 'g')));--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_drafts_user_kind_idx" ON "code_access_drafts" USING btree ("guild_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "code_access_drafts_expiry_idx" ON "code_access_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "code_access_escalations_status_idx" ON "code_access_escalations" USING btree ("guild_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_evidence_s3_key_idx" ON "code_access_evidence" USING btree ("s3_key");--> statement-breakpoint
CREATE INDEX "code_access_evidence_expiry_idx" ON "code_access_evidence" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_feedback_requests_thread_idx" ON "code_access_feedback_requests" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "code_access_feedback_requests_pending_idx" ON "code_access_feedback_requests" USING btree ("resolved_at","reminder_sent_at","penalized_at");--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_penalties_guild_user_idx" ON "code_access_penalties" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_slots_device_idx" ON "code_access_slots" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_access_slots_order_idx" ON "code_access_slots" USING btree ("guild_id","order_code") WHERE "code_access_slots"."order_code" is not null;--> statement-breakpoint
CREATE INDEX "code_access_slots_user_steam_idx" ON "code_access_slots" USING btree ("guild_id","user_id","steam_username");--> statement-breakpoint
CREATE INDEX "code_access_slots_purchase_sha_idx" ON "code_access_slots" USING btree ("purchase_proof_sha256");--> statement-breakpoint
CREATE INDEX "code_access_slots_subscription_end_idx" ON "code_access_slots" USING btree ("subscription_end");--> statement-breakpoint
CREATE UNIQUE INDEX "steam_code_mail_message_idx" ON "steam_code_mail_cache" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE INDEX "steam_code_mail_account_received_idx" ON "steam_code_mail_cache" USING btree ("steam_username","received_at");--> statement-breakpoint
CREATE INDEX "ai_snapshots_guild_created_idx" ON "ai_response_snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_snapshots_query_idx" ON "ai_response_snapshots" USING btree ("guild_id","query_hash","role_scope_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_sessions_identity_idx" ON "conversation_sessions" USING btree ("guild_id","channel_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_sessions_expires_idx" ON "conversation_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_limit_counts_scope_day_idx" ON "daily_limit_counts" USING btree ("scope_key","day");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_key_hit_at_idx" ON "rate_limit_hits" USING btree ("key","hit_at");--> statement-breakpoint
CREATE INDEX "feedback_guild_status_idx" ON "feedback" USING btree ("guild_id","review_status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_request_idx" ON "feedback" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_request_user_idx" ON "feedback" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_guild_idx" ON "knowledge_chunks" USING btree ("guild_id");