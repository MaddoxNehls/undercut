import { isOnline, listCollectors, listDomainSummaries, type Collector, type DomainSummary, type KindStats } from '@undercut/db';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AddDevice } from '@/components/add-device';
import { RouteBadge } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/lib/db';
import { percent } from '@/lib/format';
import { revokeCollectorAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Devices' };

export default async function DevicesPage() {
  const [collectors, domains, h] = await Promise.all([listCollectors(db()), listDomainSummaries(db()), headers()]);
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3210'}`;
  const now = new Date();

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Devices</h1>
      <p className="mt-1 max-w-2xl text-ink-2">
        Cloud workers check sites that let them. Sites that block cloud traffic are routed to a local collector: a small
        program on your own computer that uses a real browser on your home connection.
      </p>

      <section className="mt-8" aria-labelledby="collectors-heading">
        <h2 id="collectors-heading" className="mb-3 text-lg font-semibold">
          Collectors
        </h2>
        <div className="mb-4">
          <AddDevice origin={origin} />
        </div>
        {collectors.length === 0 ? (
          <p className="text-sm text-ink-2">No collectors yet. Add one above to start collecting from your own machine.</p>
        ) : (
          <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface">
            {collectors.map((c) => (
              <CollectorRow key={c.id} collector={c} online={isOnline(c, now)} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="routing-heading">
        <h2 id="routing-heading" className="text-lg font-semibold">
          Domain routing
        </h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-ink-2">
          Each site starts on the cloud. When more than half of its recent cloud checks are blocked, its checks move to local
          collectors, and the cloud is re-tested every few hours to see if it can take them back.
        </p>
        {domains.length === 0 ? (
          <p className="text-sm text-ink-2">Sites appear here once you add a watch.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-rule text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Collected by</th>
                  <th className="px-3 py-2 font-medium">Cloud, recently blocked</th>
                  <th className="px-3 py-2 font-medium">Local, recently blocked</th>
                  <th className="px-3 py-2 font-medium">Last cloud probe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {domains.map((d) => (
                  <DomainRow key={d.domain} domain={d} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function CollectorRow({ collector: c, online }: { collector: Collector; online: boolean }) {
  const revoked = c.revokedAt !== null;
  return (
    <li className={`flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 ${revoked ? 'opacity-60' : ''}`}>
      <div className="flex min-w-48 items-center gap-2.5">
        <span
          className={`size-2 rounded-full ${online ? 'bg-good' : 'bg-rule-strong'}`}
          role="img"
          aria-label={online ? 'Online' : 'Offline'}
        />
        <div>
          <div className="font-semibold">{c.name}</div>
          <div className="text-xs text-muted">
            {c.kind === 'local' ? 'Local collector' : 'Cloud worker'}, token …{c.tokenHint}
          </div>
        </div>
      </div>
      <div className="text-sm text-ink-2">
        {revoked ? (
          <>
            Revoked <LocalTime date={c.revokedAt!} mode="relative" />
          </>
        ) : c.lastSeenAt ? (
          <>
            {online ? 'Online' : 'Last seen'} <LocalTime date={c.lastSeenAt} mode="relative" />
          </>
        ) : (
          'Never connected'
        )}
      </div>
      {(c.hostname || c.version) && (
        <div className="text-xs text-muted">
          {[c.hostname, c.version].filter(Boolean).join(', ')}
        </div>
      )}
      {!revoked && (
        <form action={revokeCollectorAction.bind(null, c.id)} className="ml-auto">
          <SubmitButton variant="danger" confirm={`Revoke “${c.name}”? It will stop receiving jobs immediately.`}>
            Revoke
          </SubmitButton>
        </form>
      )}
    </li>
  );
}

function DomainRow({ domain: d }: { domain: DomainSummary }) {
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="font-semibold">{d.domain}</div>
        <div className="text-xs text-muted">
          {d.watchCount} {d.watchCount === 1 ? 'watch' : 'watches'}
        </div>
      </td>
      <td className="px-3 py-3">
        <RouteBadge route={d.route} />
        <div className="mt-1 max-w-64 text-xs text-ink-2">
          {d.routeReason ?? 'Starting route'}, since <LocalTime date={d.routeChangedAt} mode="relative" />
        </div>
      </td>
      <td className="px-3 py-3">
        <BlockRate stats={d.stats.cloud} />
      </td>
      <td className="px-3 py-3">
        <BlockRate stats={d.stats.local} />
      </td>
      <td className="px-3 py-3 text-ink-2">{d.lastProbeAt ? <LocalTime date={d.lastProbeAt} mode="relative" /> : '—'}</td>
    </tr>
  );
}

/** Recent block rate as a meter (the number routing acts on) with lifetime counts beneath. */
function BlockRate({ stats }: { stats: KindStats }) {
  if (stats.attempts === 0) return <span className="text-muted">No checks</span>;
  const rate = stats.recentBlockRate ?? 0;
  return (
    <div className="w-48">
      <div className="flex items-baseline justify-between">
        <span className="figure text-base font-semibold">{percent(stats.recentBlockRate)}</span>
        <span className="text-xs text-muted">of last {stats.recentAttempts}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-good-wash" aria-hidden="true">
        <div className="h-full rounded-full bg-critical" style={{ width: `${Math.round(rate * 100)}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">
        {stats.ok} ok, {stats.blocked} blocked, {stats.parseErrors} parse errors
      </div>
    </div>
  );
}
