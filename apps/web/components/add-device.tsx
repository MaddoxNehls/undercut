'use client';

import { useActionState, useState } from 'react';
import { addLocalCollectorAction, type AddDeviceState } from '@/app/devices/actions';
import { SubmitButton } from './submit-button';

/** Creates a local collector and shows its token exactly once, with the commands to use it. */
export function AddDevice({ origin }: { origin: string }) {
  const [state, action] = useActionState<AddDeviceState, FormData>(addLocalCollectorAction, { status: 'idle' });

  if (state.status === 'created') {
    const login = `undercut-collector login --server ${origin} --token ${state.token}`;
    return (
      <div className="rounded-lg border border-accent bg-accent-wash p-5">
        <h3 className="font-semibold">“{state.name}” is ready to connect</h3>
        <p className="mt-1 text-sm text-ink-2">
          Copy the token now. It is shown only once; Undercut stores just a hash of it.
        </p>
        <ol className="mt-4 space-y-3 text-sm">
          <li>
            <span className="mb-1 block font-medium">On that machine, sign the collector in:</span>
            <Command text={login} />
          </li>
          <li>
            <span className="mb-1 block font-medium">Then start it. It picks up jobs routed to local collectors:</span>
            <Command text="undercut-collector run" />
          </li>
        </ol>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 text-sm font-medium text-accent hover:underline">
          Done, I saved the token
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <div>
        <label htmlFor="device-name" className="sr-only">
          Device name
        </label>
        <input
          id="device-name"
          name="name"
          placeholder="Home PC"
          className="w-56 rounded-md border border-rule-strong bg-surface px-3 py-1.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {state.status === 'error' && (
          <p className="mt-1 text-sm text-critical" role="alert">
            {state.message}
          </p>
        )}
      </div>
      <SubmitButton pendingLabel="Creating…">Add local collector</SubmitButton>
    </form>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-rule-strong bg-surface">
      <code className="flex-1 overflow-x-auto px-3 py-2 text-[13px] whitespace-nowrap">{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true));
        }}
        className="border-l border-rule-strong px-3 text-sm font-medium hover:bg-paper"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
