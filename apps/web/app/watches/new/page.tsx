import type { Metadata } from 'next';
import { WatchForm } from '@/components/watch-form';
import { createWatchAction } from '../actions';

export const metadata: Metadata = { title: 'New watch' };

export default function NewWatchPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">New watch</h1>
      <p className="mt-1 mb-8 max-w-2xl text-ink-2">The first check runs as soon as you save.</p>
      <WatchForm
        action={createWatchAction}
        submitLabel="Create watch"
        cancelHref="/"
        initial={{ name: '', url: '', selector: '', attribute: '', currency: '', locale: '', intervalMinutes: '360', routeOverride: 'auto' }}
      />
    </>
  );
}
