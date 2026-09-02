-- conversation_sessions (0007) only had enough columns for a bare turn
-- counter and lock expiry. The store needs the full ConversationSession
-- shape (opened-by/last-user message ids, last request id, opened-at, and
-- the lock's start time rather than a precomputed expiry) to be a faithful
-- Postgres mirror of MemoryConversationSessionStore. Nothing writes to this
-- table yet, so it is safe to assume it is empty in every environment.
ALTER TABLE "conversation_sessions" ADD COLUMN "opened_by_message_id" varchar(32);
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD COLUMN "last_user_message_id" varchar(32);
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD COLUMN "last_request_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD COLUMN "opened_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD COLUMN "locked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" DROP COLUMN "lock_expires_at";
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ALTER COLUMN "opened_by_message_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ALTER COLUMN "last_user_message_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ALTER COLUMN "opened_at" SET NOT NULL;
