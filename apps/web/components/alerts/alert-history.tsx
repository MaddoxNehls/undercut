import type { AlertListEntry } from '@undercut/db';
import Link from 'next/link';
import { LocalTime } from '../local-time';

const KIND: Record<AlertListEntry['kind'], string> = { below_target: 'Below target', drop_pct: 'Price drop', all_time_low: 'All-time low' };
const CHANNEL = { email: 'Email', ntfy: 'ntfy', webpush: 'Browser push' } as const;
const DELIVERY = {
  sent: { label: 'sent', className: 'text-good' },
  pending: { label: 'queued', className: 'text-warning' },
  failed: { label: 'failed', className: 'text-critical' },
} as const;

/** Fired alerts with the state of each channel's delivery. */
export function AlertHistory({ alerts, showWatch }: { alerts: AlertListEntry[]; showWatch: boolean }) {
  if (alerts.length === 0) {
    return <p className="rounded-lg border border-dashed border-rule-strong p-6 text-center text-sm text-ink-2">No alerts have fired yet.</p>;
  }
  return (
    <ol className="divide-y divide-rule rounded-lg border border-rule bg-surface">
      {alerts.map((a) => (
        <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium">
              {showWatch && (
                <Link href={`/watches/${a.watchId}`} className="text-accent hover:underline">
                  {a.watchName}
                </Link>
              )}
              {showWatch && ': '}
              {a.message}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {KIND[a.kind]}, <LocalTime date={a.createdAt} />
            </p>
          </div>
          <ul className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-xs">
            {a.deliveries.length === 0 && <li className="text-muted">No channels configured</li>}
            {a.deliveries.map((d, i) => (
              <li key={i} title={d.lastError ?? undefined}>
                <span className="text-ink-2">{CHANNEL[d.channel]} </span>
                <span className={`font-semibold ${DELIVERY[d.status].className}`}>{DELIVERY[d.status].label}</span>
                {d.attempts > 1 && <span className="text-muted"> after {d.attempts} tries</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
