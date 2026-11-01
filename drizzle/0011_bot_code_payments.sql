CREATE TABLE IF NOT EXISTS bot_code_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code bigint NOT NULL UNIQUE,
  user_id varchar(32) NOT NULL,
  account varchar(128) NOT NULL,
  amount integer NOT NULL CHECK (amount = 100000),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','paid','fulfilled','cancelled','expired')),
  checkout_url text,
  provider_link_id text,
  gmail_message_id text,
  code_digest text,
  discord_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  last_checked_at timestamptz,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS bot_code_active_user_account ON bot_code_orders(user_id, account)
  WHERE status IN ('creating', 'pending', 'paid');
CREATE UNIQUE INDEX IF NOT EXISTS bot_code_delivery_once ON bot_code_orders(user_id, account, gmail_message_id)
  WHERE status = 'fulfilled';
CREATE INDEX IF NOT EXISTS bot_code_poll ON bot_code_orders(status, last_checked_at);

ALTER TABLE bot_code_orders ADD COLUMN IF NOT EXISTS code_digest text;
CREATE UNIQUE INDEX IF NOT EXISTS bot_code_value_once ON bot_code_orders(user_id, account, code_digest)
  WHERE status='fulfilled';
