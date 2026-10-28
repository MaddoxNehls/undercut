import type { Metadata } from 'next';
import { AnalyzeForm } from '@/components/analyze-form';
import { WatchForm } from '@/components/watch-form';
import { createWatchAction } from '../actions';

export const metadata: Metadata = { title: 'New watch' };

export default function NewWatchPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">New watch</h1>
      <p className="mt-1 mb-8 max-w-2xl text-ink-2">The first check runs as soon as you save.</p>
      <AnalyzeForm />
      <details className="mt-8 max-w-2xl">
        <summary className="cursor-pointer text-sm font-semibold text-accent">Or enter a selector yourself</summary>
        <div className="mt-6">
          <WatchForm
            action={createWatchAction}
            submitLabel="Create watch"
            cancelHref="/"
            initial={{ name: '', url: '', selector: '', attribute: '', currency: '', locale: '', intervalMinutes: '360', routeOverride: 'auto' }}
          />
        </div>
      </details>
    </>
  );
}
