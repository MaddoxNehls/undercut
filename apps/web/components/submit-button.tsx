'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-rule-strong bg-surface text-ink hover:border-ink-2',
  danger: 'border border-rule-strong bg-surface text-critical hover:border-critical',
};

/** A submit button that disables itself while its form's action is pending. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  confirm,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: Variant;
  /** Ask before submitting (destructive actions). */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${VARIANTS[variant]}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
