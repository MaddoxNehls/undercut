import { listAlerts } from '@undercut/db';
import type { Metadata } from 'next';
import { AlertHistory } from '@/components/alerts/alert-history';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Alerts' };

export default async function AlertsPage() {
  const alerts = await listAlerts(db(), { limit: 100 });
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
      <p className="mt-1 mb-8 max-w-2xl text-ink-2">Every alert that fired, newest first, with the delivery status of each channel.</p>
      <div className="max-w-4xl">
        <AlertHistory alerts={alerts} showWatch />
      </div>
    </>
  );
}
