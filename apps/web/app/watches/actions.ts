'use server';

import { isHttpUrl } from '@undercut/core';
import { createWatch, deleteWatch, enqueueNow, getWatch, updateWatch, type WatchInput } from '@undercut/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';

const KNOWN_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const optional = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .pipe(schema.optional());

const watchFormSchema = z.object({
  name: z.string().trim().min(1, 'Give the watch a name.').max(120, 'Keep the name under 120 characters.'),
  url: z.string().trim().refine(isHttpUrl, 'Enter a full URL starting with http:// or https://.'),
  selector: z.string().trim().min(1, 'Enter the CSS selector of the price element.').max(500),
  attribute: optional(z.string().max(60)),
  currency: optional(
    z
      .string()
      .toUpperCase()
      .refine((code) => KNOWN_CURRENCIES.has(code), 'Use a 3-letter currency code, like USD or EUR.'),
  ),
  locale: optional(z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a locale tag, like en-US or de-DE.')),
  intervalMinutes: z.coerce.number().int('Use whole minutes.').min(5, 'Check at most every 5 minutes.').max(10080, 'Check at least weekly.'),
  routeOverride: z.enum(['auto', 'cloud', 'local']),
});

export type WatchFormField = keyof z.input<typeof watchFormSchema>;
export type WatchFormValues = Record<WatchFormField, string>;
export interface WatchFormState {
  errors: Partial<Record<WatchFormField, string>>;
  values: WatchFormValues;
}

const FIELDS: readonly WatchFormField[] = ['name', 'url', 'selector', 'attribute', 'currency', 'locale', 'intervalMinutes', 'routeOverride'];

function readForm(form: FormData): WatchFormValues {
  return Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? '')])) as WatchFormValues;
}

function parse(form: FormData): { input: WatchInput } | { state: WatchFormState } {
  const values = readForm(form);
  const parsed = watchFormSchema.safeParse(values);
  if (!parsed.success) {
    const errors: WatchFormState['errors'] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as WatchFormField;
      errors[field] ??= issue.message;
    }
    return { state: { errors, values } };
  }
  const { selector, attribute, ...rest } = parsed.data;
  return { input: { ...rest, extraction: { kind: 'selector', selector, attribute } } };
}

export async function createWatchAction(_prev: WatchFormState | null, form: FormData): Promise<WatchFormState> {
  const result = parse(form);
  if ('state' in result) return result.state;
  const watch = await createWatch(db(), result.input);
  // Check right away instead of waiting for the next scheduler slot.
  await enqueueNow(db(), watch.id);
  revalidatePath('/');
  redirect(`/watches/${watch.id}`);
}

export async function updateWatchAction(id: string, _prev: WatchFormState | null, form: FormData): Promise<WatchFormState> {
  const result = parse(form);
  if ('state' in result) return result.state;
  const existing = await getWatch(db(), id);
  if (!existing) redirect('/');
  await updateWatch(db(), id, { ...result.input, active: existing.watch.active });
  revalidatePath(`/watches/${id}`);
  redirect(`/watches/${id}`);
}

export async function checkNowAction(id: string): Promise<void> {
  await enqueueNow(db(), id);
  revalidatePath(`/watches/${id}`);
}

export async function setActiveAction(id: string, active: boolean): Promise<void> {
  const existing = await getWatch(db(), id);
  if (!existing) return;
  const { watch } = existing;
  await updateWatch(db(), id, {
    name: watch.name,
    url: watch.url,
    extraction: watch.extraction,
    currency: watch.currency,
    locale: watch.locale,
    intervalMinutes: watch.intervalMinutes,
    routeOverride: watch.routeOverride,
    active,
  });
  revalidatePath(`/watches/${id}`);
}

export async function deleteWatchAction(id: string): Promise<void> {
  await deleteWatch(db(), id);
  revalidatePath('/');
  redirect('/');
}
