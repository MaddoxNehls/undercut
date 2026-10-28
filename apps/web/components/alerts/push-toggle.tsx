'use client';

import { useEffect, useState, useTransition } from 'react';
import { deletePushSubscriptionAction, savePushSubscriptionAction } from '@/app/alerts/actions';

type Status = 'unsupported' | 'loading' | 'off' | 'on' | 'denied';

/** Subscribes this browser to Web Push with the server's VAPID public key. */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return setStatus('unsupported');
    if (Notification.permission === 'denied') return setStatus('denied');
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? 'on' : 'off'))
      .catch(() => setStatus('unsupported'));
  }, [vapidPublicKey]);

  const toggle = () =>
    start(async () => {
      setError(null);
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await deletePushSubscriptionAction(existing.endpoint);
          await existing.unsubscribe();
          setStatus('off');
          return;
        }
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidPublicKey!) });
        await savePushSubscriptionAction(JSON.stringify(sub));
        setStatus('on');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (Notification.permission === 'denied') setStatus('denied');
      }
    });

  const label: Record<Status, string> = {
    unsupported: 'This browser (or server config) does not support push.',
    loading: 'Checking…',
    off: 'Off for this browser.',
    on: 'On for this browser.',
    denied: 'Blocked in browser settings.',
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-ink-2">{label[status]}</span>
      {(status === 'on' || status === 'off') && (
        <button type="button" onClick={toggle} disabled={pending} className="rounded-md border border-rule-strong bg-surface px-3 py-1.5 font-semibold hover:border-ink-2 disabled:opacity-60">
          {status === 'on' ? 'Turn off' : 'Enable browser push'}
        </button>
      )}
      {error && <span className="text-critical">{error}</span>}
    </div>
  );
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
