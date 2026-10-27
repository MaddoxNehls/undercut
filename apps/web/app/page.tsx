import { formatPrice } from '@undercut/core';
import { listWatchSummaries, type WatchSummary } from '@undercut/db';
import Link from 'next/link';
import { RouteBadge, StatusPill } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { Sparkline } from '@/components/sparkline';
import { db } from '@/lib/db';
import { intervalLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function WatchesPage() {
  const watches = await listWatchSummaries(db());

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Watches</h1>
          <p className="mt-1 text-ink-2">
            {watches.length === 0
              ? 'Nothing tracked yet.'
              : `${watches.length} ${watches.length === 1 ? 'price' : 'prices'} tracked, newest first.`}
          </p>
        </div>
      </div>

      {watches.length === 0 ? <EmptyState /> : (
        <ul className="divide-y divide-rule border-y border-rule bg-surface">
          {watches.map((w) => (
            <WatchRow key={w.id} watch={w} />
          ))}
        </ul>
      )}
    </>
  );
}

function WatchRow({ watch: w }: { watch: WatchSummary }) {
  const route = w.routeOverride === 'auto' ? w.domainRoute : w.routeOverride;
  return (
    <li>
      <Link
        href={`/watches/${w.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-4 hover:bg-paper sm:grid-cols-[minmax(0,1fr)_120px_10rem_9rem] sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{w.name}</span>
            {!w.active && <span className="rounded bg-paper px-1.5 text-xs text-muted">Paused</span>}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted">
            {w.domain}, {intervalLabel(w.intervalMinutes)}
          </div>
        </div>

        <div className="hidden sm:block">
          <Sparkline values={w.recentPrices} />
        </div>

        <div className="text-right">
          <div className="figure text-2xl leading-tight font-bold">
            {w.latestPrice === null ? <span className="text-muted">—</span> : formatPrice(w.latestPrice, w.latestCurrency)}
          </div>
          <div className="text-xs text-muted">
            {w.latestPriceAt ? (
              <>
                as of <LocalTime date={w.latestPriceAt} mode="relative" />
              </>
            ) : w.pendingJob ? (
              'first check queued'
            ) : (
              'no price yet'
            )}
          </div>
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
          {w.lastStatus && w.lastStatus !== 'ok' && <StatusPill status={w.lastStatus} />}
          <RouteBadge route={route} learned={w.routeOverride === 'auto'} />
          {w.pendingJob && (
            <span className="inline-flex items-center gap-1 text-xs text-accent" title="A check is queued or running">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              Checking
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-rule-strong bg-surface px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">Track your first price</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-2">
        Paste a product or listing URL and the CSS selector of its price. Undercut checks it on a schedule and keeps the
        history, including sites that block cloud scrapers.
      </p>
      <Link href="/watches/new" className="mt-6 inline-block rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90">
        Add a watch
      </Link>
    </div>
  );
}
