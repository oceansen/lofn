-- Optional reference image shown with a question (e.g. the slide a group is improving).
CREATE TABLE question_images (
  question_id uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp','image/gif')),
  data        bytea NOT NULL,
  alt         text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
