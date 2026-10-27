'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import type { WatchFormField, WatchFormState, WatchFormValues } from '@/app/watches/actions';
import { SubmitButton } from './submit-button';

const INTERVAL_PRESETS: ReadonlyArray<[label: string, minutes: number]> = [
  ['30 min', 30],
  ['1 hour', 60],
  ['6 hours', 360],
  ['24 hours', 1440],
];

const ROUTES: ReadonlyArray<{ value: WatchFormValues['routeOverride']; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Start in the cloud; switch to your local collector if this site starts blocking.' },
  { value: 'cloud', label: 'Cloud only', hint: 'Always use cloud workers.' },
  { value: 'local', label: 'Local only', hint: 'Always use a collector on your own machine.' },
];

type Action = (prev: WatchFormState | null, form: FormData) => Promise<WatchFormState>;

export function WatchForm({ action, initial, submitLabel, cancelHref }: {
  action: Action;
  initial: WatchFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const values = state?.values ?? initial;
  const errors = state?.errors ?? {};
  const [interval, setIntervalValue] = useState(values.intervalMinutes);

  return (
    <form action={formAction} className="max-w-2xl space-y-8" noValidate>
      <Section title="What to track">
        <Field name="name" label="Name" error={errors.name}>
          <input id="name" name="name" defaultValue={values.name} placeholder="Atelier Playa Mujeres, Nov 12–16" className={input} />
        </Field>
        <Field name="url" label="Page URL" error={errors.url}>
          <input id="url" name="url" type="url" defaultValue={values.url} placeholder="https://…" className={input} />
        </Field>
      </Section>

      <Section title="Where the price is" note="Undercut reads the first element matching this selector after the page renders.">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field name="selector" label="CSS selector" error={errors.selector}>
            <input id="selector" name="selector" defaultValue={values.selector} placeholder=".product_main .price_color" className={`${input} font-mono text-sm`} />
          </Field>
          <Field name="attribute" label="Attribute" hint="Optional. Read it instead of the text." error={errors.attribute}>
            <input id="attribute" name="attribute" defaultValue={values.attribute} placeholder="content" className={`${input} font-mono text-sm`} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="currency" label="Currency" hint="Optional. Resolves “$” or “kr”." error={errors.currency}>
            <input id="currency" name="currency" defaultValue={values.currency} placeholder="USD" maxLength={3} className={`${input} uppercase`} />
          </Field>
          <Field name="locale" label="Page locale" hint="Optional. Decides if 1.299 means 1299." error={errors.locale}>
            <input id="locale" name="locale" defaultValue={values.locale} placeholder="en-US" className={input} />
          </Field>
        </div>
      </Section>

      <Section title="How often">
        <Field name="intervalMinutes" label="Check every (minutes)" error={errors.intervalMinutes}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="intervalMinutes"
              name="intervalMinutes"
              type="number"
              min={5}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              className={`${inputBase} w-28`}
            />
            {INTERVAL_PRESETS.map(([label, minutes]) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setIntervalValue(String(minutes))}
                aria-pressed={interval === String(minutes)}
                className="rounded-md border border-rule-strong px-2.5 py-1.5 text-sm hover:border-ink-2 aria-pressed:border-accent aria-pressed:bg-accent-wash aria-pressed:text-accent"
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Who collects it">
        <fieldset className="grid gap-2" aria-describedby={errors.routeOverride ? 'routeOverride-error' : undefined}>
          <legend className="sr-only">Collector routing</legend>
          {ROUTES.map((r) => (
            <label key={r.value} className="flex cursor-pointer gap-3 rounded-md border border-rule bg-surface p-3 has-checked:border-accent has-checked:bg-accent-wash">
              <input type="radio" name="routeOverride" value={r.value} defaultChecked={values.routeOverride === r.value} className="mt-1 accent-(--accent)" />
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-sm text-ink-2">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Section>

      <div className="flex items-center gap-3 border-t border-rule pt-6">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="text-sm text-ink-2 hover:text-ink">
          Cancel
        </Link>
      </div>
    </form>
  );
}

const inputBase =
  'rounded-md border border-rule-strong bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-accent focus:outline-none group-data-invalid:border-critical';
const input = `${inputBase} w-full`;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {note && <p className="text-sm text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ name, label, hint, error, children }: {
  name: WatchFormField;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="group space-y-1.5" data-invalid={error ? '' : undefined}>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-critical" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
