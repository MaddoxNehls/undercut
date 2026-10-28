'use client';

import { useActionState } from 'react';
import { analyzeUrlAction } from '@/app/watches/new/analyze-actions';
import { SubmitButton } from './submit-button';

/** Step one of adding a watch: paste a URL and let Undercut find the price. */
export function AnalyzeForm() {
  const [state, action] = useActionState(analyzeUrlAction, null);
  return (
    <form action={action} className="max-w-2xl rounded-lg border border-rule bg-surface p-5" noValidate>
      <label htmlFor="analyze-url" className="text-lg font-semibold">
        Paste a product or booking page
      </label>
      <p className="mt-1 text-sm text-ink-2">
        Undercut opens it in a real browser and finds the price for you. Structured data (JSON-LD, microdata, OpenGraph) is tried first; an
        LLM is asked only when those disagree or are missing.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          id="analyze-url"
          name="url"
          type="url"
          required
          defaultValue={state?.url ?? ''}
          placeholder="https://books.toscrape.com/catalogue/…"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? 'analyze-error' : undefined}
          className="min-w-0 flex-1 rounded-md border border-rule-strong bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <SubmitButton pendingLabel="Opening the page…">Find the price</SubmitButton>
      </div>
      {state?.error && (
        <p id="analyze-error" role="alert" className="mt-2 text-sm text-critical">
          {state.error}
        </p>
      )}
    </form>
  );
}
