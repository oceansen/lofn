-- Group context: background material a group supplies (notes and files such as their slides) that the
-- synthesis can use for every question when the group switches it on.
CREATE TABLE group_context (
  group_id    uuid PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  text        text NOT NULL DEFAULT '',
  active_hash text NOT NULL DEFAULT '',      -- hash of the context answers should reflect now ('' = none)
  updated_by  uuid REFERENCES participants(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_context_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id       uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  name           text NOT NULL,
  mime           text NOT NULL,
  size_bytes     bigint NOT NULL,
  storage_key    text NOT NULL,
  sha256         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  error          text,
  extracted      text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);
CREATE INDEX group_context_files_group ON group_context_files(group_id, created_at);

-- Which context the current answer version was written with.
ALTER TABLE answers ADD COLUMN context_hash text NOT NULL DEFAULT '';
