import {
  deliverAt,
  DEFAULT_ALERT_POLICY,
  evaluateRule,
  formatPrice,
  type AlertPolicy,
  type AlertRule,
  type ObservationHook,
  type ObservationRecorded,
  type QuietHours,
} from '@undercut/core';
import type { Channel, ChannelKind } from '@undercut/notify';
import { inTransaction, type Db } from './client';
import { toNumberOrNull } from './types';

export type AlertRuleKind = AlertRule['kind'];

export interface AlertRuleRow {
  id: string;
  watchId: string;
  kind: AlertRuleKind;
  threshold: number | null;
  active: boolean;
  lastAlertPrice: number | null;
  lastAlertAt: Date | null;
  lastQualifiedAt: Date | null;
  createdAt: Date;
}

type RawRule = Omit<AlertRuleRow, 'threshold' | 'lastAlertPrice'> & { threshold: string | null; lastAlertPrice: string | null };
const toRule = (r: RawRule): AlertRuleRow => ({ ...r, threshold: toNumberOrNull(r.threshold), lastAlertPrice: toNumberOrNull(r.lastAlertPrice) });

export function toAlertRule(row: Pick<AlertRuleRow, 'kind' | 'threshold'>): AlertRule {
  switch (row.kind) {
    case 'below_target':
      return { kind: 'below_target', target: row.threshold ?? 0 };
    case 'drop_pct':
      return { kind: 'drop_pct', pct: row.threshold ?? 0 };
    case 'all_time_low':
      return { kind: 'all_time_low' };
  }
}

export async function listAlertRules(db: Db, watchId: string): Promise<AlertRuleRow[]> {
  return (await db<RawRule[]>`SELECT * FROM alert_rules WHERE watch_id = ${watchId} ORDER BY created_at`).map(toRule);
}

export async function createAlertRule(db: Db, watchId: string, kind: AlertRuleKind, threshold: number | null): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    INSERT INTO alert_rules (watch_id, kind, threshold) VALUES (${watchId}, ${kind}, ${threshold}) RETURNING id`;
  if (!row) throw new Error('alert_rules insert returned no row');
  return row.id;
}

export async function deleteAlertRule(db: Db, ruleId: string): Promise<void> {
  await db`DELETE FROM alert_rules WHERE id = ${ruleId}`;
}

export async function setAlertRuleActive(db: Db, ruleId: string, active: boolean): Promise<void> {
  await db`UPDATE alert_rules SET active = ${active} WHERE id = ${ruleId}`;
}

export interface NotificationSettings {
  email: string | null;
  ntfyTopic: string | null;
  quietStart: string | null;
  quietEnd: string | null;
  timeZone: string;
}

export async function getNotificationSettings(db: Db): Promise<NotificationSettings> {
  const [row] = await db<NotificationSettings[]>`SELECT email, ntfy_topic, quiet_start, quiet_end, time_zone FROM notification_settings WHERE id = 1`;
  return row ?? { email: null, ntfyTopic: null, quietStart: null, quietEnd: null, timeZone: 'UTC' };
}

export async function saveNotificationSettings(db: Db, s: NotificationSettings): Promise<void> {
  await db`
    UPDATE notification_settings SET email = ${s.email}, ntfy_topic = ${s.ntfyTopic}, quiet_start = ${s.quietStart},
      quiet_end = ${s.quietEnd}, time_zone = ${s.timeZone}, updated_at = now()
    WHERE id = 1`;
}

export async function savePushSubscription(db: Db, subscription: { endpoint: string } & Record<string, unknown>): Promise<void> {
  await db`
    INSERT INTO push_subscriptions (endpoint, subscription) VALUES (${subscription.endpoint}, ${db.json(subscription as never)})
    ON CONFLICT (endpoint) DO UPDATE SET subscription = EXCLUDED.subscription`;
}

export async function deletePushSubscription(db: Db, endpoint: string): Promise<void> {
  await db`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

export async function countPushSubscriptions(db: Db): Promise<number> {
  const [row] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM push_subscriptions`;
  return row?.n ?? 0;
}

/** Where alerts go right now: one target per configured channel (every browser for push). */
async function deliveryTargets(db: Db): Promise<{ channel: ChannelKind; target: string }[]> {
  const settings = await getNotificationSettings(db);
  const targets: { channel: ChannelKind; target: string }[] = [];
  if (settings.email) targets.push({ channel: 'email', target: settings.email });
  if (settings.ntfyTopic) targets.push({ channel: 'ntfy', target: settings.ntfyTopic });
  for (const { subscription } of await db<{ subscription: unknown }[]>`SELECT subscription FROM push_subscriptions`) {
    targets.push({ channel: 'webpush', target: JSON.stringify(subscription) });
  }
  return targets;
}

function quietHours(s: NotificationSettings): QuietHours | null {
  return s.quietStart && s.quietEnd ? { start: s.quietStart, end: s.quietEnd, timeZone: s.timeZone } : null;
}

/**
 * Evaluates a variant's alert rules after an observation and records what fires.
 *
 * Runs in its own transaction after the observation commits (alerting can never lose collected
 * data). Rule rows are locked FOR UPDATE, so two observations evaluated concurrently see each
 * other's hysteresis state, and `UNIQUE (rule_id, level)` makes a duplicate alert impossible
 * even if they didn't. The alert, its deliveries, and the rule state commit together.
 */
export async function evaluateAlerts(db: Db, event: ObservationRecorded, policy: AlertPolicy = DEFAULT_ALERT_POLICY): Promise<string[]> {
  if (event.status !== 'ok' || event.price === null) return [];
  const settings = await getNotificationSettings(db);
  const targets = await deliveryTargets(db);

  return inTransaction(db, async (tx) => {
    const rules = (await tx<RawRule[]>`
      SELECT r.* FROM alert_rules r JOIN watches w ON w.id = r.watch_id
      WHERE r.watch_id = ${event.watchId} AND r.active AND w.meaning <> 'was'
      ORDER BY r.id FOR UPDATE OF r`).map(toRule);
    if (rules.length === 0) return [];

    const history = (
      await tx<{ price: string; asOf: Date }[]>`
        SELECT price, as_of FROM observations
        WHERE variant_id = ${event.variantId} AND status = 'ok' AND as_of <= ${event.asOf}
        ORDER BY as_of DESC LIMIT 200`
    )
      .reverse()
      .map((r) => ({ price: Number(r.price), at: r.asOf }));

    const fired: string[] = [];
    for (const rule of rules) {
      const lastAlert = rule.lastAlertPrice !== null && rule.lastAlertAt ? { price: rule.lastAlertPrice, at: rule.lastAlertAt } : null;
      const result = evaluateRule(toAlertRule(rule), history, { lastAlert, lastQualifiedAt: rule.lastQualifiedAt }, policy, (n) => formatPrice(n, event.currency));
      if (result.qualifies) await tx`UPDATE alert_rules SET last_qualified_at = ${event.asOf} WHERE id = ${rule.id}`;
      if (!result.fire || result.level === null) continue;

      const [alert] = await tx<{ id: string }[]>`
        INSERT INTO alerts (rule_id, watch_id, observation_id, price, currency, level, message)
        VALUES (${rule.id}, ${event.watchId}, ${event.observationId}, ${result.level}, ${event.currency},
                ${Math.round(result.level * 100)}, ${result.message})
        ON CONFLICT (rule_id, level) DO NOTHING
        RETURNING id`;
      if (!alert) continue;
      await tx`UPDATE alert_rules SET last_alert_price = ${result.level}, last_alert_at = ${event.asOf} WHERE id = ${rule.id}`;
      const notBefore = deliverAt(new Date(), quietHours(settings));
      for (const t of targets) {
        await tx`INSERT INTO deliveries (alert_id, channel, target, not_before) VALUES (${alert.id}, ${t.channel}, ${t.target}, ${notBefore})`;
      }
      fired.push(alert.id);
    }
    return fired;
  });
}

/** The alert engine as an observation hook (registered by the web app's result endpoint). */
export function alertHook(db: Db, policy?: AlertPolicy): ObservationHook {
  return { name: 'alerts', onObservation: async (event) => void (await evaluateAlerts(db, event, policy)) };
}

export interface AlertListEntry {
  id: string;
  watchId: string;
  watchName: string;
  kind: AlertRuleKind;
  price: number;
  currency: string | null;
  message: string;
  createdAt: Date;
  deliveries: { channel: ChannelKind; status: 'pending' | 'sent' | 'failed'; attempts: number; lastError: string | null; notBefore: Date }[];
}

export async function listAlerts(db: Db, options: { watchId?: string; limit?: number } = {}): Promise<AlertListEntry[]> {
  const rows = await db<(Omit<AlertListEntry, 'price'> & { price: string })[]>`
    SELECT a.id, a.watch_id, w.name AS watch_name, r.kind, a.price, a.currency, a.message, a.created_at,
           COALESCE(json_agg(json_build_object('channel', d.channel, 'status', d.status, 'attempts', d.attempts,
                    'lastError', d.last_error, 'notBefore', d.not_before) ORDER BY d.channel) FILTER (WHERE d.id IS NOT NULL), '[]') AS deliveries
    FROM alerts a
    JOIN alert_rules r ON r.id = a.rule_id
    JOIN watches w ON w.id = a.watch_id
    LEFT JOIN deliveries d ON d.alert_id = a.id
    WHERE ${options.watchId ? db`a.watch_id = ${options.watchId}` : db`true`}
    GROUP BY a.id, w.name, r.kind
    ORDER BY a.created_at DESC
    LIMIT ${options.limit ?? 50}`;
  return rows.map((r) => ({ ...r, price: Number(r.price), deliveries: r.deliveries.map((d) => ({ ...d, notBefore: new Date(d.notBefore) })) }));
}

const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3600;
const CLAIM_SECONDS = 120;

export interface DispatchResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Sends due deliveries. Each is first claimed (attempts + 1, pushed out by a claim window) with
 * SKIP LOCKED, so concurrent dispatchers never double-send, and a crash mid-send just retries
 * after the claim lapses. Failures back off exponentially until `max_attempts`.
 */
export async function dispatchDeliveries(
  db: Db,
  channels: Partial<Record<ChannelKind, Channel>>,
  options: { limit?: number; appUrl?: string } = {},
): Promise<DispatchResult> {
  const claimed = await db<{ id: string; channel: ChannelKind; target: string; attempts: number; maxAttempts: number; message: string; watchName: string; watchId: string }[]>`
    WITH due AS (
      SELECT id FROM deliveries WHERE status = 'pending' AND not_before <= now()
      ORDER BY not_before LIMIT ${options.limit ?? 50} FOR UPDATE SKIP LOCKED
    )
    UPDATE deliveries d SET attempts = d.attempts + 1, not_before = now() + ${CLAIM_SECONDS}::int * interval '1 second'
    FROM due, alerts a, watches w
    WHERE d.id = due.id AND a.id = d.alert_id AND w.id = a.watch_id
    RETURNING d.id, d.channel, d.target, d.attempts, d.max_attempts, a.message, w.name AS watch_name, w.id AS watch_id`;

  const result: DispatchResult = { sent: 0, retried: 0, failed: 0 };
  for (const d of claimed) {
    const channel = channels[d.channel];
    try {
      if (!channel) throw new Error(`channel ${d.channel} is not configured`);
      await channel.send({ title: `Price alert: ${d.watchName}`, body: d.message, url: `${options.appUrl ?? 'http://localhost:3210'}/watches/${d.watchId}` }, d.target);
      await db`UPDATE deliveries SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = ${d.id}`;
      result.sent++;
    } catch (err) {
      const exhausted = d.attempts >= d.maxAttempts;
      const backoff = Math.min(BACKOFF_BASE_SECONDS * 2 ** (d.attempts - 1), BACKOFF_MAX_SECONDS);
      await db`
        UPDATE deliveries SET status = ${exhausted ? 'failed' : 'pending'},
          last_error = ${(err instanceof Error ? err.message : String(err)).slice(0, 500)},
          not_before = now() + ${backoff}::int * interval '1 second'
        WHERE id = ${d.id}`;
      if (exhausted) result.failed++;
      else result.retried++;
    }
  }
  return result;
}
