ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "review_status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "reviewed_by" varchar(32);--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "cache_invalidated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_guild_status_idx" ON "feedback" USING btree ("guild_id","review_status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_request_idx" ON "feedback" USING btree ("request_id");--> statement-breakpoint
DELETE FROM "feedback" a
USING "feedback" b
WHERE a."request_id" = b."request_id"
  AND a."user_id" = b."user_id"
  AND a."created_at" < b."created_at";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_request_user_idx" ON "feedback" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_response_snapshots" (
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
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_snapshots_guild_created_idx" ON "ai_response_snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_snapshots_query_idx" ON "ai_response_snapshots" USING btree ("guild_id","query_hash","role_scope_hash");
