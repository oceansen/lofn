-- Multiple facilitator accounts: roles, status, and sign-in identities (Google, GitHub).
ALTER TABLE admins ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE admins ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member'));
ALTER TABLE admins ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disabled'));
ALTER TABLE admins ADD COLUMN avatar_url text NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN last_login_at timestamptz;
-- Accounts that existed before this migration administer the instance.
UPDATE admins SET role = 'admin';

CREATE TABLE admin_identities (
  provider   text NOT NULL CHECK (provider IN ('google','github')),
  subject    text NOT NULL,             -- the provider's stable user id
  admin_id   uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  email      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX admin_identities_admin_idx ON admin_identities(admin_id);
