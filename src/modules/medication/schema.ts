// Additive, idempotent bootstrap migration: also works with existing Dokploy volumes.
export const medicationSchema = `
CREATE TABLE IF NOT EXISTS medication_settings (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT true,
 title text NOT NULL DEFAULT 'Mthi thúi đến giờ uống thuốc !!!',
 description text NOT NULL DEFAULT 'Em thúi uống thuốc xong ấn confirm cho tôy nhé',
 max_repeats integer NOT NULL DEFAULT 2 CHECK(max_repeats BETWEEN 0 AND 5),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO medication_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS medication_doses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
 day date NOT NULL, test boolean NOT NULL DEFAULT false,
 scheduled_at timestamptz NOT NULL, closes_at timestamptz NOT NULL,
 title text NOT NULL, description text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','taken','skipped','unconfirmed')),
 taken_at timestamptz, next_send_at timestamptz NOT NULL DEFAULT now(),
 sends integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
 last_error text, message_id text, channel_id text,
 UNIQUE(user_id,day,test)
);
ALTER TABLE medication_doses ADD COLUMN IF NOT EXISTS admin_notified_at timestamptz;
ALTER TABLE medication_doses ADD COLUMN IF NOT EXISTS admin_notify_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE medication_doses ADD COLUMN IF NOT EXISTS admin_notify_due_at timestamptz;
ALTER TABLE medication_doses ADD COLUMN IF NOT EXISTS admin_notify_error text;
CREATE INDEX IF NOT EXISTS medication_due_idx ON medication_doses(next_send_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS medication_history_idx ON medication_doses(user_id,test,day);
CREATE TABLE IF NOT EXISTS medication_audit (
 id bigserial PRIMARY KEY, actor_id text NOT NULL, action text NOT NULL,
 dose_id uuid REFERENCES medication_doses(id), created_at timestamptz NOT NULL DEFAULT now()
);`;
