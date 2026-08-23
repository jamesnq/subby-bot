CREATE TABLE "faq_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(32) NOT NULL,
	"query_hash" varchar(64) NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"citations" jsonb,
	"role_scope_hash" varchar(64) DEFAULT '' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"guild_id" varchar(32) NOT NULL,
	"day" varchar(10) NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_guild_id_day_pk" PRIMARY KEY("guild_id","day")
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "mod_role_id" varchar(32);--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "mod_log_channel_id" varchar(32);--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "support_category_id" varchar(32);--> statement-breakpoint
CREATE UNIQUE INDEX "faq_cache_guild_query_idx" ON "faq_cache" USING btree ("guild_id","query_hash","role_scope_hash");--> statement-breakpoint
CREATE INDEX "faq_cache_expiry_idx" ON "faq_cache" USING btree ("expires_at");