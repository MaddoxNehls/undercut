'use client';

import type { NotificationSettings } from '@undercut/db';
import { useActionState, useState, useTransition } from 'react';
import { saveSettingsAction, sendTestAction } from '@/app/alerts/actions';
import { SubmitButton } from '../submit-button';

const field = 'mt-1 block w-full rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal';

export function SettingsForm({ settings }: { settings: NotificationSettings }) {
  const [state, action] = useActionState(saveSettingsAction, null);
  return (
    <form action={action} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Email
          <input name="email" type="email" defaultValue={settings.email ?? ''} placeholder="you@example.com" className={field} />
          <TestButton channel="email" />
        </label>
        <label className="text-sm font-medium">
          ntfy topic
          <input name="ntfyTopic" defaultValue={settings.ntfyTopic ?? ''} placeholder="undercut-alerts" className={`${field} font-mono text-sm`} />
          <TestButton channel="ntfy" />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Quiet hours</legend>
        <p className="text-sm text-ink-2">Alerts that fire during quiet hours are held and delivered when they end.</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            From
            <input name="quietStart" type="time" defaultValue={settings.quietStart ?? ''} className={field} />
          </label>
          <label className="text-sm">
            Until
            <input name="quietEnd" type="time" defaultValue={settings.quietEnd ?? ''} className={field} />
          </label>
          <label className="text-sm">
            Time zone
            <input name="timeZone" defaultValue={settings.timeZone} list="time-zones" className={field} />
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
        {state?.saved && <span className="text-sm text-good">Saved.</span>}
        {state?.error && (
          <span role="alert" className="text-sm text-critical">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}

function TestButton({ channel }: { channel: 'email' | 'ntfy' }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="mt-1 flex items-center gap-2 text-xs font-normal">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await sendTestAction(channel)))}
        className="font-semibold text-accent hover:underline disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send a test (saved settings)'}
      </button>
      {result && <span className={result.ok ? 'text-good' : 'text-critical'}>{result.message}</span>}
    </span>
  );
}
