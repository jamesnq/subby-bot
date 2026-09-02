CREATE TABLE "rate_limit_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(128) NOT NULL,
	"hit_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_limit_counts" (
	"scope_key" varchar(128) NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_sessions" (
	"guild_id" varchar(32) NOT NULL,
	"channel_id" varchar(32) NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lock_expires_at" timestamp with time zone,
	"last_bot_message_id" varchar(32),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hits_key_hit_at_idx" ON "rate_limit_hits" USING btree ("key","hit_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_limit_counts_scope_day_idx" ON "daily_limit_counts" USING btree ("scope_key","day");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_sessions_identity_idx" ON "conversation_sessions" USING btree ("guild_id","channel_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_sessions_expires_idx" ON "conversation_sessions" USING btree ("expires_at");
