import { countPushSubscriptions, getNotificationSettings } from '@undercut/db';
import type { Metadata } from 'next';
import { PushToggle } from '@/components/alerts/push-toggle';
import { SettingsForm } from '@/components/alerts/settings-form';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationSettingsPage() {
  const [settings, browsers] = await Promise.all([getNotificationSettings(db()), countPushSubscriptions(db())]);
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
      <p className="mt-1 mb-8 max-w-2xl text-ink-2">
        Where alerts go. Every channel is retried with backoff if it fails, and each alert shows its delivery status on the Alerts page.
      </p>
      <div className="max-w-3xl space-y-10">
        <section className="rounded-lg border border-rule bg-surface p-5">
          <SettingsForm settings={settings} />
        </section>
        <section className="rounded-lg border border-rule bg-surface p-5" aria-labelledby="push-heading">
          <h2 id="push-heading" className="font-semibold">
            Browser push
          </h2>
          <p className="mb-3 text-sm text-ink-2">
            {browsers} {browsers === 1 ? 'browser is' : 'browsers are'} subscribed.
          </p>
          <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        </section>
      </div>
      <datalist id="time-zones">
        {Intl.supportedValuesOf('timeZone').map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
    </>
  );
}
