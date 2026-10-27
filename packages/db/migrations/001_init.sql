-- Undercut schema v1: watches, collection jobs, observations, and learned per-domain routing.

-- One row per site. Holds the learned route and the politeness budget for that site.
CREATE TABLE domains (
  domain              text PRIMARY KEY,
  route               text NOT NULL DEFAULT 'cloud' CHECK (route IN ('cloud', 'local')),
  route_reason        text,
  route_changed_at    timestamptz NOT NULL DEFAULT now(),
  last_probe_at       timestamptz,
  max_concurrency     integer NOT NULL DEFAULT 1 CHECK (max_concurrency > 0),
  min_interval_ms     integer NOT NULL DEFAULT 5000 CHECK (min_interval_ms >= 0),
  respect_robots      boolean NOT NULL DEFAULT true,
  last_dispatched_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE watches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  url               text NOT NULL,
  domain            text NOT NULL REFERENCES domains (domain),
  extraction        jsonb NOT NULL,
  currency          text,
  locale            text,
  interval_minutes  integer NOT NULL DEFAULT 360 CHECK (interval_minutes >= 5),
  route_override    text NOT NULL DEFAULT 'auto' CHECK (route_override IN ('auto', 'cloud', 'local')),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A watch tracks one or more variants (e.g. date window x room type). Every watch has a default.
CREATE TABLE watch_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id    uuid NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  label       text NOT NULL,
  url         text,
  params      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, label)
);

-- Cloud workers and local devices. Only a SHA-256 of the bearer token is stored.
CREATE TABLE collectors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('cloud', 'local')),
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  token_hint    text NOT NULL,
  version       text,
  hostname      text,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id        uuid NOT NULL REFERENCES watch_variants (id) ON DELETE CASCADE,
  domain            text NOT NULL REFERENCES domains (domain),
  url               text NOT NULL,
  route             text NOT NULL CHECK (route IN ('cloud', 'local')),
  is_probe          boolean NOT NULL DEFAULT false,
  -- (variant, scheduled slot): a retried scheduler tick can never create a second job.
  idempotency_key   text NOT NULL UNIQUE,
  scheduled_for     timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'done', 'failed', 'skipped')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  not_before        timestamptz NOT NULL DEFAULT now(),
  lease_id          uuid,
  leased_by         uuid REFERENCES collectors (id) ON DELETE SET NULL,
  lease_expires_at  timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

-- Backlog guard: at most one outstanding job (and one outstanding probe) per variant. If a
-- collector is offline, new slots are skipped rather than piling up.
CREATE UNIQUE INDEX jobs_one_outstanding_per_variant
  ON jobs (variant_id, is_probe) WHERE status IN ('queued', 'leased');
CREATE INDEX jobs_leasable ON jobs (route, scheduled_for) WHERE status IN ('queued', 'leased');
CREATE INDEX jobs_active_by_domain ON jobs (domain) WHERE status = 'leased';

CREATE TABLE observations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One observation per job, ever: retries and late duplicate reports cannot double-record.
  job_id         uuid NOT NULL UNIQUE REFERENCES jobs (id) ON DELETE CASCADE,
  variant_id     uuid NOT NULL REFERENCES watch_variants (id) ON DELETE CASCADE,
  domain         text NOT NULL,
  collector_id   uuid REFERENCES collectors (id) ON DELETE SET NULL,
  collector_kind text NOT NULL CHECK (collector_kind IN ('cloud', 'local')),
  is_probe       boolean NOT NULL DEFAULT false,
  status         text NOT NULL CHECK (status IN ('ok', 'blocked', 'parse_error')),
  price          numeric(16, 4),
  currency       text,
  price_kind     text CHECK (price_kind IN ('exact', 'from', 'range')),
  price_max      numeric(16, 4),
  period         text,
  reason         text,
  raw_snippet    text,
  http_status    integer,
  final_url      text,
  duration_ms    integer,
  as_of          timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ok' OR price IS NOT NULL)
);

CREATE INDEX observations_variant_time ON observations (variant_id, as_of DESC);
CREATE INDEX observations_domain_kind_time ON observations (domain, collector_kind, as_of DESC);

-- Lifetime outcome counters per (domain, collector kind), for the block-rate dashboard.
-- Routing decisions read the recent window from observations instead.
CREATE TABLE domain_stats (
  domain           text NOT NULL REFERENCES domains (domain) ON DELETE CASCADE,
  collector_kind   text NOT NULL CHECK (collector_kind IN ('cloud', 'local')),
  attempts         integer NOT NULL DEFAULT 0,
  ok               integer NOT NULL DEFAULT 0,
  blocked          integer NOT NULL DEFAULT 0,
  parse_errors     integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  last_blocked_at  timestamptz,
  PRIMARY KEY (domain, collector_kind)
);
