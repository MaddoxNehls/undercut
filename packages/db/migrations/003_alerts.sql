-- M4: alert rules, alerts, notification channels, and delivery records.

CREATE TABLE alert_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id           uuid NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('below_target', 'drop_pct', 'all_time_low')),
  -- Target price for below_target, percent for drop_pct, unused for all_time_low.
  threshold          numeric(16, 4),
  active             boolean NOT NULL DEFAULT true,
  -- Hysteresis state, updated in the same transaction as the alert it describes.
  last_alert_price   numeric(16, 4),
  last_alert_at      timestamptz,
  last_qualified_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'all_time_low' OR threshold IS NOT NULL)
);
CREATE INDEX alert_rules_by_watch ON alert_rules (watch_id);

CREATE TABLE alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         uuid NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  watch_id        uuid NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  observation_id  uuid REFERENCES observations (id) ON DELETE SET NULL,
  price           numeric(16, 4) NOT NULL,
  currency        text,
  -- The alerted price level in minor units: one alert per rule per price level, even when
  -- concurrent observations evaluate the same rule at the same moment.
  level           bigint NOT NULL,
  message         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, level)
);
CREATE INDEX alerts_by_watch ON alerts (watch_id, created_at DESC);

-- Single-tenant for now: one settings row.
CREATE TABLE notification_settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email        text,
  ntfy_topic   text,
  quiet_start  text,
  quiet_end    text,
  time_zone    text NOT NULL DEFAULT 'UTC',
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO notification_settings (id) VALUES (1);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      uuid NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email', 'ntfy', 'webpush')),
  target        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  -- Quiet hours and retry backoff both push this forward.
  not_before    timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, channel, target)
);
CREATE INDEX deliveries_due ON deliveries (not_before) WHERE status = 'pending';
