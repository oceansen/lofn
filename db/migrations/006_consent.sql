-- Participant consent (GDPR consent + optional HIPAA authorization).
-- The form a participant agrees to is stored verbatim per version, so each signature proves exactly what was shown.
CREATE TABLE project_consent (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL DEFAULT '{}',
  reviewed    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  document    jsonb NOT NULL,
  text        text NOT NULL,
  text_sha256 text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  UNIQUE (project_id, text_sha256)
);

CREATE TABLE participant_consents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id           uuid REFERENCES groups(id) ON DELETE SET NULL,
  participant_id     uuid REFERENCES participants(id) ON DELETE SET NULL,
  alias              text NOT NULL,
  consent_version_id uuid NOT NULL REFERENCES consent_versions(id) ON DELETE CASCADE,
  signed_name        text NOT NULL,
  choices            jsonb NOT NULL,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  withdrawn_at       timestamptz,
  erased_contributions integer
);
CREATE INDEX participant_consents_participant ON participant_consents(participant_id);
CREATE INDEX participant_consents_project ON participant_consents(project_id, signed_at DESC);
