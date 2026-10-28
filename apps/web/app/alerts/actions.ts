'use server';

import {
  createAlertRule,
  deleteAlertRule,
  deletePushSubscription,
  getNotificationSettings,
  saveNotificationSettings,
  savePushSubscription,
  setAlertRuleActive,
  type AlertRuleKind,
} from '@undercut/db';
import { channelsFromEnv, type ChannelKind } from '@undercut/notify';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';

const ruleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('below_target'), threshold: z.coerce.number().positive('Enter a target price above zero.') }),
  z.object({ kind: z.literal('drop_pct'), threshold: z.coerce.number().min(1, 'Use at least 1%.').max(90, 'Use at most 90%.') }),
  z.object({ kind: z.literal('all_time_low') }),
]);

export interface RuleFormState {
  error: string | null;
}

export async function createRuleAction(watchId: string, _prev: RuleFormState | null, form: FormData): Promise<RuleFormState> {
  const parsed = ruleSchema.safeParse({ kind: form.get('kind'), threshold: form.get('threshold') || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the rule.' };
  const kind: AlertRuleKind = parsed.data.kind;
  await createAlertRule(db(), watchId, kind, 'threshold' in parsed.data ? parsed.data.threshold : null);
  revalidatePath(`/watches/${watchId}/alerts`);
  return { error: null };
}

export async function deleteRuleAction(watchId: string, ruleId: string): Promise<void> {
  await deleteAlertRule(db(), ruleId);
  revalidatePath(`/watches/${watchId}/alerts`);
}

export async function toggleRuleAction(watchId: string, ruleId: string, active: boolean): Promise<void> {
  await setAlertRuleActive(db(), ruleId, active);
  revalidatePath(`/watches/${watchId}/alerts`);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const settingsSchema = z.object({
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]),
  ntfyTopic: z.union([z.literal(''), z.string().regex(/^[\w-]{1,64}$/, 'Topics use letters, digits, - and _ only.')]),
  quietStart: z.union([z.literal(''), z.string().regex(TIME, 'Use HH:MM.')]),
  quietEnd: z.union([z.literal(''), z.string().regex(TIME, 'Use HH:MM.')]),
  timeZone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC', 'Unknown time zone.'),
});

export interface SettingsFormState {
  error: string | null;
  saved: boolean;
}

export async function saveSettingsAction(_prev: SettingsFormState | null, form: FormData): Promise<SettingsFormState> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the settings.', saved: false };
  const s = parsed.data;
  if (Boolean(s.quietStart) !== Boolean(s.quietEnd)) return { error: 'Set both ends of quiet hours, or neither.', saved: false };
  await saveNotificationSettings(db(), {
    email: s.email || null,
    ntfyTopic: s.ntfyTopic || null,
    quietStart: s.quietStart || null,
    quietEnd: s.quietEnd || null,
    timeZone: s.timeZone,
  });
  revalidatePath('/settings/notifications');
  return { error: null, saved: true };
}

export async function sendTestAction(channel: ChannelKind): Promise<{ ok: boolean; message: string }> {
  const settings = await getNotificationSettings(db());
  const target = channel === 'email' ? settings.email : channel === 'ntfy' ? settings.ntfyTopic : null;
  const sender = channelsFromEnv()[channel];
  if (!target || !sender) return { ok: false, message: `Set up ${channel} first.` };
  try {
    await sender.send({ title: 'Undercut test alert', body: 'If you can read this, price alerts will reach you here.', url: 'http://localhost:3210/alerts' }, target);
    return { ok: true, message: `Sent to ${target}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const subscriptionSchema = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export async function savePushSubscriptionAction(json: string): Promise<void> {
  const subscription = subscriptionSchema.parse(JSON.parse(json));
  await savePushSubscription(db(), subscription);
  revalidatePath('/settings/notifications');
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<void> {
  await deletePushSubscription(db(), endpoint);
  revalidatePath('/settings/notifications');
}
