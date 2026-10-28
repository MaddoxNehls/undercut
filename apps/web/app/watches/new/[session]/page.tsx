import { formatPrice, ruleToText, type PriceCandidate } from '@undercut/core';
import { getExtractionSession } from '@undercut/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { createFromCandidateAction } from '../analyze-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Confirm the price' };

const MEANING: Record<PriceCandidate['meaning'], string> = {
  current: 'Current price',
  was: 'Previous ("was") price',
  per_unit: 'Per night / per unit',
  total: 'Total',
};
const SOURCE: Record<PriceCandidate['source'], string> = {
  'json-ld': 'JSON-LD structured data',
  microdata: 'schema.org microdata',
  opengraph: 'OpenGraph product tags',
  'class-pattern': 'Price-like class name',
  llm: 'LLM, from the page digest',
};

export default async function PickCandidatePage({ params, searchParams }: {
  params: Promise<{ session: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { session: id } = await params;
  const session = isUuid(id) ? await getExtractionSession(db(), id) : null;
  if (!session) notFound();
  const failed = (await searchParams).error === '1';

  return (
    <>
      <Link href="/watches/new" className="text-sm text-ink-2 hover:text-ink">
        Start over
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Which one is the price?</h1>
      <p className="mt-1 max-w-3xl text-ink-2">
        Found {session.candidates.length} {session.candidates.length === 1 ? 'candidate' : 'candidates'} on{' '}
        <a href={session.finalUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {session.title || session.url}
        </a>
        . Each was checked by running its rule against the rendered page. {session.usedLlm ? `The LLM was consulted because ${session.reason}.` : 'No LLM was needed: '}
        {!session.usedLlm && <>{session.reason}.</>}
      </p>

      <form action={createFromCandidateAction.bind(null, id)} className="mt-8">
        <fieldset>
          <legend className="sr-only">Price candidates</legend>
          <ol className="grid gap-4 lg:grid-cols-2">
            {session.candidates.map((c, i) => (
              <li key={i}>
                <label className="flex h-full cursor-pointer flex-col gap-4 rounded-lg border-2 border-rule bg-surface p-4 has-[:checked]:border-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent sm:flex-row">
                  <input type="radio" name="candidate" value={i} defaultChecked={i === 0} className="sr-only" />
                  <div className="flex h-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule bg-paper sm:w-56">
                    {c.crop ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL screenshot, nothing to optimize
                      <img src={c.crop} alt={`The highlighted element on the page for candidate ${i + 1}`} className="max-h-28 max-w-full object-contain" />
                    ) : (
                      <span className="px-3 text-center text-xs text-muted">Not shown on the page (read from structured data)</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="figure text-2xl font-bold">{c.price ? formatPrice(c.price.amount, c.price.currency) : '—'}</span>
                      <span className="text-xs text-muted">{Math.round(c.confidence * 100)}% confident</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{MEANING[c.meaning]}</p>
                    <p className="text-xs text-ink-2">{SOURCE[c.source]}</p>
                    <code className="mt-2 block truncate text-[12px] text-ink-2" title={ruleToText(c.rule)}>
                      {ruleToText(c.rule)}
                    </code>
                    {c.rationale && <p className="mt-2 text-xs text-ink-2">{c.rationale}</p>}
                    {i === 0 && <span className="mt-2 inline-block rounded-full bg-accent-wash px-2 py-0.5 text-xs font-semibold text-accent">Best match</span>}
                  </div>
                </label>
              </li>
            ))}
          </ol>
        </fieldset>

        <div className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-[1fr_10rem_10rem]">
          <label className="block text-sm font-medium">
            Name
            <input name="name" required defaultValue={session.title.split('|')[0]?.trim() ?? ''} className="mt-1 w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal" />
          </label>
          <label className="block text-sm font-medium">
            Check every
            <select name="intervalMinutes" defaultValue="360" className="mt-1 w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal">
              <option value="60">1 hour</option>
              <option value="360">6 hours</option>
              <option value="1440">24 hours</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Collect with
            <select name="routeOverride" defaultValue="auto" className="mt-1 w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal">
              <option value="auto">Automatic</option>
              <option value="cloud">Cloud only</option>
              <option value="local">Local only</option>
            </select>
          </label>
        </div>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-critical">
            Pick a candidate and give the watch a name.
          </p>
        )}
        <div className="mt-6">
          <SubmitButton pendingLabel="Creating…">Track this price</SubmitButton>
        </div>
      </form>
    </>
  );
}
