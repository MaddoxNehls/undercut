import { formatPrice } from '@undercut/core';
import { getWatch, listAlertRules, listAlerts, type AlertRuleRow } from '@undercut/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertHistory } from '@/components/alerts/alert-history';
import { RuleForm } from '@/components/alerts/rule-form';
import { LocalTime } from '@/components/local-time';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { deleteRuleAction, toggleRuleAction } from '../../../alerts/actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Alert rules' };

function describeRule(rule: AlertRuleRow, currency: string | null): string {
  switch (rule.kind) {
    case 'below_target':
      return `Price at or below ${formatPrice(rule.threshold ?? 0, currency)}`;
    case 'drop_pct':
      return `Price ${rule.threshold}% or more below the recent median`;
    case 'all_time_low':
      return 'New all-time low';
  }
}

export default async function WatchAlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = isUuid(id) ? await getWatch(db(), id) : null;
  if (!detail) notFound();
  const { watch } = detail;
  const [rules, alerts, [latest]] = await Promise.all([
    listAlertRules(db(), id),
    listAlerts(db(), { watchId: id }),
    db()<{ currency: string | null }[]>`SELECT o.currency FROM observations o JOIN watch_variants v ON v.id = o.variant_id WHERE v.watch_id = ${id} AND o.status = 'ok' ORDER BY o.as_of DESC LIMIT 1`,
  ]);
  const currency = latest?.currency ?? watch.currency;

  return (
    <>
      <Link href={`/watches/${id}`} className="text-sm text-ink-2 hover:text-ink">
        {watch.name}
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Alert rules</h1>
      <p className="mt-1 max-w-3xl text-ink-2">
        Prices flap, so a rule only fires on a price confirmed by two checks in a row. After an alert, it fires again only if the price drops
        another {formatPrice(25, currency)} or the rule went a full day without matching.{' '}
        <Link href="/settings/notifications" className="font-medium text-accent hover:underline">
          Choose where alerts go
        </Link>
        .
      </p>

      <section className="mt-8 max-w-3xl space-y-4" aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="sr-only">
          Rules
        </h2>
        {rules.length > 0 && (
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className={`font-medium ${rule.active ? '' : 'text-muted line-through'}`}>{describeRule(rule, currency)}</p>
                  <p className="text-xs text-muted">
                    {rule.lastAlertAt ? (
                      <>
                        Last alerted at {formatPrice(rule.lastAlertPrice ?? 0, currency)}, <LocalTime date={rule.lastAlertAt} />
                      </>
                    ) : (
                      'Has not fired yet'
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={toggleRuleAction.bind(null, id, rule.id, !rule.active)}>
                    <SubmitButton variant="secondary">{rule.active ? 'Pause' : 'Resume'}</SubmitButton>
                  </form>
                  <form action={deleteRuleAction.bind(null, id, rule.id)}>
                    <SubmitButton variant="danger">Delete</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <RuleForm watchId={id} currency={currency} />
      </section>

      <section className="mt-10 max-w-3xl" aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold">
          Alert history
        </h2>
        <AlertHistory alerts={alerts} showWatch={false} />
      </section>
    </>
  );
}
