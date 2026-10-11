-- Lofn initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  token_hash  text PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions(admin_id);

CREATE TABLE projects (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  default_cycle_minutes integer NOT NULL DEFAULT 15 CHECK (default_cycle_minutes BETWEEN 1 AND 1440),
  media_retention_days integer CHECK (media_retention_days IS NULL OR media_retention_days >= 0),
  synthesis_guidance   text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_idx ON projects(owner_id);

CREATE TABLE questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  title        text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questions_project_idx ON questions(project_id, position);

CREATE TABLE groups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  access_code          text NOT NULL UNIQUE,
  code_active          boolean NOT NULL DEFAULT true,
  contribution_counter integer NOT NULL DEFAULT 0,
  participant_counter  integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX groups_project_idx ON groups(project_id);

CREATE TABLE group_questions (
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, question_id)
);
CREATE INDEX group_questions_question_idx ON group_questions(question_id);

CREATE TABLE cycles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name              text NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  note              text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','ended')),
  duration_ms       bigint NOT NULL CHECK (duration_ms > 0),
  carry_forward     boolean NOT NULL DEFAULT false,
  started_at        timestamptz,
  ends_at           timestamptz,       -- authoritative end while running
  remaining_ms      bigint,            -- authoritative remaining while paused
  ended_at          timestamptz,
  next_synthesis_at timestamptz,
  final_status      text NOT NULL DEFAULT 'none' CHECK (final_status IN ('none','pending','done')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cycles_project_idx ON cycles(project_id, position);
-- At most one live (running or paused) cycle per project.
CREATE UNIQUE INDEX cycles_one_live_per_project ON cycles(project_id) WHERE status IN ('running','paused');

CREATE TABLE participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  alias        text NOT NULL,          -- anonymous label e.g. "P4"
  display_name text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participants_group_idx ON participants(group_id);

CREATE TABLE contributions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no           integer NOT NULL,   -- short per-group reference, shown as C12
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  cycle_id         uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  participant_id   uuid REFERENCES participants(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('text','audio','image','image_text','video')),
  text_content     text NOT NULL DEFAULT '',   -- original text, never modified by AI
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','failed')),
  processing_error text,
  hidden           boolean NOT NULL DEFAULT false,
  hidden_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  UNIQUE (group_id, ref_no)
);
CREATE INDEX contributions_scope_idx ON contributions(cycle_id, group_id, question_id, created_at);
CREATE INDEX contributions_project_idx ON contributions(project_id, created_at);

CREATE TABLE media (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  participant_id  uuid REFERENCES participants(id) ON DELETE SET NULL,
  contribution_id uuid REFERENCES contributions(id) ON DELETE SET NULL,
  position        integer NOT NULL DEFAULT 0,
  category        text NOT NULL CHECK (category IN ('image','audio','video')),
  storage_key     text NOT NULL,
  mime            text NOT NULL,
  size_bytes      bigint NOT NULL,
  original_name   text NOT NULL DEFAULT '',
  sha256          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX media_contribution_idx ON media(contribution_id);
CREATE INDEX media_project_idx ON media(project_id);

-- AI-derived artefacts are stored separately so originals are never altered.
CREATE TABLE derivations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  media_id        uuid REFERENCES media(id) ON DELETE SET NULL,
  type            text NOT NULL CHECK (type IN ('transcript','description')),
  content         text NOT NULL,
  provider        text NOT NULL,
  model           text NOT NULL DEFAULT '',
  is_fallback     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX derivations_contribution_idx ON derivations(contribution_id);
-- Reuse cache: identical media bytes never get re-analysed.
CREATE INDEX media_sha_idx ON media(sha256);

CREATE TABLE answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cycle_id        uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  group_id        uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  question_id     uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  current_version integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','queued','synthesizing','error')),
  is_final        boolean NOT NULL DEFAULT false,
  last_error      text,
  lease_token     text,
  lease_until     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, group_id, question_id)
);
CREATE INDEX answers_project_idx ON answers(project_id);

CREATE TABLE answer_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id    uuid NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  content      jsonb NOT NULL,
  change_note  text NOT NULL DEFAULT '',
  added_refs   integer[] NOT NULL DEFAULT '{}',
  removed_refs integer[] NOT NULL DEFAULT '{}',
  trigger      text NOT NULL CHECK (trigger IN ('tick','final','manual','carry')),
  provider     text NOT NULL,
  model        text NOT NULL DEFAULT '',
  is_fallback  boolean NOT NULL DEFAULT false,
  is_final     boolean NOT NULL DEFAULT false,
  warnings     text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (answer_id, version)
);

CREATE TABLE answer_contributions (
  answer_id       uuid NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  contribution_id uuid NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('included','removed','skipped')),
  version         integer NOT NULL,
  PRIMARY KEY (answer_id, contribution_id)
);

CREATE TABLE project_syntheses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cycle_id     uuid REFERENCES cycles(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error')),
  content      jsonb,
  provider     text,
  model        text,
  is_fallback  boolean NOT NULL DEFAULT false,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX project_syntheses_project_idx ON project_syntheses(project_id, created_at DESC);

-- Durable job queue (SELECT ... FOR UPDATE SKIP LOCKED).
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  dedupe_key   text,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_by    text,
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs(run_at) WHERE status = 'queued';
CREATE INDEX jobs_running_idx ON jobs(locked_until) WHERE status = 'running';
CREATE UNIQUE INDEX jobs_dedupe_queued ON jobs(dedupe_key) WHERE status = 'queued' AND dedupe_key IS NOT NULL;
