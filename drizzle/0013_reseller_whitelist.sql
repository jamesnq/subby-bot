CREATE TABLE IF NOT EXISTS code_reseller_whitelist (
  user_id varchar(32) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
