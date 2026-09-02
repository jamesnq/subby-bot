CREATE TABLE IF NOT EXISTS "steam_code_mail_cache" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "steam_code_mail_message_idx"
  ON "steam_code_mail_cache" ("gmail_message_id");

CREATE INDEX IF NOT EXISTS "steam_code_mail_account_received_idx"
  ON "steam_code_mail_cache" ("steam_username", "received_at");
