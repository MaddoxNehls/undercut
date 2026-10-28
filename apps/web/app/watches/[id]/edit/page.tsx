import { ruleToText } from '@undercut/core';
import { getWatch } from '@undercut/db';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WatchForm } from '@/components/watch-form';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { updateWatchAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit watch' };

export default async function EditWatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = isUuid(id) ? await getWatch(db(), id) : null;
  if (!detail) notFound();
  const { watch } = detail;

  return (
    <>
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Edit {watch.name}</h1>
      <WatchForm
        action={updateWatchAction.bind(null, id)}
        submitLabel="Save changes"
        cancelHref={`/watches/${id}`}
        initial={{
          name: watch.name,
          url: watch.url,
          selector: ruleToText(watch.extraction),
          attribute: watch.extraction.kind === 'selector' ? (watch.extraction.attribute ?? '') : '',
          currency: watch.currency ?? '',
          locale: watch.locale ?? '',
          intervalMinutes: String(watch.intervalMinutes),
          routeOverride: watch.routeOverride,
        }}
      />
    </>
  );
}
