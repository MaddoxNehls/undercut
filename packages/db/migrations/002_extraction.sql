-- M3: LLM-assisted extraction and self-healing selectors.

-- What the tracked price means; healing only accepts a replacement with the same meaning.
ALTER TABLE watches ADD COLUMN meaning text NOT NULL DEFAULT 'current'
  CHECK (meaning IN ('current', 'was', 'per_unit', 'total'));
-- Set when self-healing found a selector it was not confident enough to apply on its own.
ALTER TABLE watches ADD COLUMN review_reason text;

-- On parse errors, the collector's page digest and validated heuristic candidates, so the
-- server can heal the selector without fetching the page again.
ALTER TABLE observations ADD COLUMN healing jsonb;

-- Every change to a watch's extraction rule, with the values before and after.
CREATE TABLE selector_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id        uuid NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  old_rule        jsonb,
  new_rule        jsonb NOT NULL,
  old_value       numeric(16, 4),
  new_value       numeric(16, 4),
  meaning         text NOT NULL,
  trigger         text NOT NULL CHECK (trigger IN ('created', 'edited', 'healed')),
  source          text NOT NULL CHECK (source IN ('user', 'json-ld', 'microdata', 'opengraph', 'class-pattern', 'llm')),
  status          text NOT NULL CHECK (status IN ('applied', 'proposed', 'accepted', 'rejected')),
  reason          text,
  observation_id  uuid REFERENCES observations (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX selector_history_by_watch ON selector_history (watch_id, created_at DESC);
-- At most one open proposal per watch.
CREATE UNIQUE INDEX selector_history_one_open ON selector_history (watch_id) WHERE status = 'proposed';

-- Results of the "paste a URL" analysis, kept until the user picks a candidate.
CREATE TABLE extraction_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url          text NOT NULL,
  final_url    text NOT NULL,
  http_status  integer,
  title        text NOT NULL,
  used_llm     boolean NOT NULL,
  reason       text NOT NULL,
  candidates   jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
