'use client';

import { useActionState, useState } from 'react';
import { createRuleAction } from '@/app/alerts/actions';
import { SubmitButton } from '../submit-button';

const KINDS = [
  { value: 'below_target', label: 'Price drops to or below', unit: 'currency' },
  { value: 'drop_pct', label: 'Price drops at least', unit: '% below the recent median' },
  { value: 'all_time_low', label: 'Price hits a new all-time low', unit: null },
] as const;

export function RuleForm({ watchId, currency }: { watchId: string; currency: string | null }) {
  const [state, action] = useActionState(createRuleAction.bind(null, watchId), null);
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('below_target');
  const selected = KINDS.find((k) => k.value === kind)!;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-rule bg-surface p-4" noValidate>
      <label className="text-sm font-medium">
        Alert me when
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="mt-1 block rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {selected.unit && (
        <label className="text-sm font-medium">
          {selected.unit === 'currency' ? `Target${currency ? ` (${currency})` : ''}` : 'Percent'}
          <span className="mt-1 flex items-center gap-2">
            <input
              name="threshold"
              type="number"
              step="any"
              min="0"
              required
              className="figure w-32 rounded-md border border-rule-strong bg-surface px-3 py-2 font-normal"
            />
            {selected.unit !== 'currency' && <span className="text-sm font-normal text-ink-2">{selected.unit}</span>}
          </span>
        </label>
      )}
      <SubmitButton pendingLabel="Adding…">Add rule</SubmitButton>
      {state?.error && (
        <p role="alert" className="w-full text-sm text-critical">
          {state.error}
        </p>
      )}
    </form>
  );
}
