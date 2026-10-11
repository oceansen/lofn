-- Instance-wide settings editable by administrators (AI provider/model choices; never secrets).
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
