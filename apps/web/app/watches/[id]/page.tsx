import { formatPrice, ruleToText } from '@undercut/core';
import { getWatch, listObservations, listRecentJobs, listSelectorHistory, priceHistory, type JobSummary, type ObservationLogEntry, type SelectorChange } from '@undercut/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { JobStatusLabel, RouteBadge, StatusPill } from '@/components/badges';
import { LocalTime } from '@/components/local-time';
import { PriceChart, type ChartFailure, type ChartSeries } from '@/components/price-chart';
import { PriceTag } from '@/components/price-tag';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/lib/db';
import { describePrice, intervalLabel, priceParts } from '@/lib/format';
import { isUuid } from '@/lib/ids';
import { SelectorHistory } from '@/components/selector-history';
import { checkNowAction, decideProposalAction, deleteWatchAction, setActiveAction } from '../actions';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ log?: string }> };

const LOG_PREVIEW = 25;

async function load(id: string) {
  return isUuid(id) ? getWatch(db(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await load((await params).id);
  return { title: detail?.watch.name ?? 'Watch not found' };
}

export default async function WatchPage({ params, searchParams }: Props) {
  const { id } = await params;
  const showFullLog = (await searchParams).log === 'all';
  const detail = await load(id);
  if (!detail) notFound();
  const { watch, variants, domain } = detail;
  const [history, log, jobs, selectorChanges] = await Promise.all([
    priceHistory(db(), id),
    listObservations(db(), id, 100),
    listRecentJobs(db(), id, 12),
    listSelectorHistory(db(), id),
  ]);
  const proposal = selectorChanges.find((c) => c.status === 'proposed');

  const latestOk = log.find((o) => o.status === 'ok' && o.price !== null);
  const learned = watch.routeOverride === 'auto';
  const route = watch.routeOverride === 'auto' ? domain.route : watch.routeOverride;
  const currency = latestOk?.currency ?? watch.currency;

  const series: ChartSeries[] = variants.map((v) => ({
    id: v.id,
    label: v.label,
    points: history.filter((p) => p.variantId === v.id).map((p) => ({ t: p.asOf.getTime(), price: p.price, collectorKind: p.collectorKind })),
  }));
  const failures: ChartFailure[] = log.flatMap((o) =>
    o.status === 'ok' ? [] : [{ t: o.asOf.getTime(), status: o.status, reason: o.reason }],
  );

  return (
    <>
      <Link href="/" className="text-sm text-ink-2 hover:text-ink">
        All watches
      </Link>

      <header className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-balance">{watch.name}</h1>
          <a href={watch.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-accent hover:underline">
            {watch.url}
          </a>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Meta label="Site">{watch.domain}</Meta>
            <Meta label="Checks">{watch.active ? intervalLabel(watch.intervalMinutes) : 'Paused'}</Meta>
            <Meta label="Selector">
              <code className="text-[13px]">{ruleToText(watch.extraction)}</code>
            </Meta>
            <Meta label="Collected by">
              <RouteBadge route={route} learned={learned} />
            </Meta>
          </dl>
          {learned && domain.routeReason && (
            <p className="mt-3 max-w-xl text-sm text-ink-2">
              {domain.route === 'local' ? 'Moved to your local collector: ' : 'Back on the cloud: '}
              {domain.routeReason} (<LocalTime date={domain.routeChangedAt} />).
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <form action={checkNowAction.bind(null, id)}>
              <SubmitButton pendingLabel="Queuing…">Check now</SubmitButton>
            </form>
            <Link href={`/watches/${id}/alerts`} className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:border-ink-2">
              Alerts
            </Link>
            <Link href={`/watches/${id}/edit`} className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-sm font-semibold hover:border-ink-2">
              Edit
            </Link>
            <form action={setActiveAction.bind(null, id, !watch.active)}>
              <SubmitButton variant="secondary">{watch.active ? 'Pause' : 'Resume'}</SubmitButton>
            </form>
            <form action={deleteWatchAction.bind(null, id)}>
              <SubmitButton variant="danger" confirm={`Delete “${watch.name}” and its whole price history?`}>
                Delete
              </SubmitButton>
            </form>
          </div>
        </div>

        <PriceTag
          parts={
            latestOk?.price != null
              ? priceParts({ price: latestOk.price, currency: latestOk.currency, kind: latestOk.priceKind, max: latestOk.priceMax, period: latestOk.period })
              : null
          }
          caption={
            latestOk ? (
              <>
                {variants.length > 1 ? `${latestOk.variantLabel}, as of ` : 'as of '}
                <LocalTime date={latestOk.asOf} />
              </>
            ) : jobs.some((j) => j.status === 'queued' || j.status === 'leased') ? (
              'First check is queued'
            ) : (
              'No successful check yet'
            )
          }
        />
      </header>

      {watch.reviewReason && <ReviewBanner watchId={id} reason={watch.reviewReason} proposal={proposal} currency={currency} />}

      <section className="mt-10 rounded-lg border border-rule bg-surface p-4 sm:p-6" aria-labelledby="history-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="history-heading" className="text-lg font-semibold">
            Price history
          </h2>
          <p className="text-sm text-muted">
            {history.length} {history.length === 1 ? 'price' : 'prices'}
            {currency ? ` in ${currency}` : ''}
          </p>
        </div>
        <PriceChart series={series} failures={failures} currency={currency} />
      </section>

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <ObservationLog entries={showFullLog ? log : log.slice(0, LOG_PREVIEW)} total={log.length} watchId={id} />
        <RecentJobs jobs={jobs} />
      </div>

      {selectorChanges.length > 0 && <SelectorHistory changes={selectorChanges} currency={currency} />}
    </>
  );
}

function ReviewBanner({ watchId, reason, proposal, currency }: { watchId: string; reason: string; proposal: SelectorChange | undefined; currency: string | null }) {
  return (
    <section role="alert" className="mt-8 rounded-lg border border-warning bg-warning-wash p-4 sm:p-5">
      <h2 className="font-semibold">The price selector stopped working and needs your review</h2>
      <p className="mt-1 text-sm text-ink-2">{reason}.</p>
      {proposal ? (
        <>
          <p className="mt-3 text-sm">
            Proposed: <code className="text-[13px]">{ruleToText(proposal.newRule)}</code>, which reads{' '}
            <strong className="figure">{proposal.newValue === null ? 'nothing' : formatPrice(proposal.newValue, currency)}</strong>
            {proposal.oldValue !== null && <> (last known {formatPrice(proposal.oldValue, currency)})</>}.
          </p>
          <div className="mt-3 flex gap-2">
            <form action={decideProposalAction.bind(null, watchId, proposal.id, true)}>
              <SubmitButton>Use the new selector</SubmitButton>
            </form>
            <form action={decideProposalAction.bind(null, watchId, proposal.id, false)}>
              <SubmitButton variant="secondary">Keep the current one</SubmitButton>
            </form>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm">
          No replacement could be found automatically. <Link href={`/watches/${watchId}/edit`} className="font-medium text-accent hover:underline">Edit the selector</Link>.
        </p>
      )}
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function ObservationLog({ entries, total, watchId }: { entries: ObservationLogEntry[]; total: number; watchId: string }) {
  return (
    <section aria-labelledby="log-heading" className="min-w-0">
      <h2 id="log-heading" className="mb-3 text-lg font-semibold">
        Observation log
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-2">Every check lands here, including blocked ones.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-rule text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">As of</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Collector</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {entries.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <LocalTime date={o.asOf} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={o.status} />
                  </td>
                  <td className="figure px-3 py-2.5 text-right text-[15px] font-semibold whitespace-nowrap">
                    {o.price !== null ? describePrice({ price: o.price, currency: o.currency, kind: o.priceKind, max: o.priceMax, period: o.period }) : '—'}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span>{o.collectorName ?? 'Removed collector'}</span>
                    <span className="block text-xs text-muted">
                      {o.collectorKind === 'local' ? 'Local' : 'Cloud'}
                      {o.isProbe ? ', routing probe' : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">
                    <div className="flex flex-wrap gap-x-3 text-xs">
                      {o.reason && <span className="font-medium text-ink">{o.reason}</span>}
                      {o.httpStatus !== null && <span>HTTP {o.httpStatus}</span>}
                      {o.durationMs !== null && <span>{(o.durationMs / 1000).toFixed(1)}s</span>}
                    </div>
                    {o.rawSnippet && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-accent">Raw snippet</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-paper p-2 text-[11px] whitespace-pre-wrap break-all">{o.rawSnippet}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length < total && (
        <Link href={`/watches/${watchId}?log=all`} scroll={false} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
          Show the latest {total} checks
        </Link>
      )}
    </section>
  );
}

function RecentJobs({ jobs }: { jobs: JobSummary[] }) {
  return (
    <section aria-labelledby="jobs-heading">
      <h2 id="jobs-heading" className="mb-3 text-lg font-semibold">
        Recent jobs
      </h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-ink-2">No jobs yet. The scheduler creates one per check interval.</p>
      ) : (
        <ol className="divide-y divide-rule rounded-lg border border-rule bg-surface text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <JobStatusLabel status={j.status} />
                <span className="text-xs text-muted">
                  <LocalTime date={j.scheduledFor} mode="relative" />
                </span>
              </div>
              <div className="mt-0.5 text-xs text-ink-2">
                {j.route === 'local' ? 'Local' : 'Cloud'}
                {j.isProbe ? ' probe' : ''}, attempt {j.attempts}
                {j.collectorName ? `, ${j.collectorName}` : ''}
              </div>
              {j.lastError && <div className="mt-1 text-xs text-critical">{j.lastError}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
