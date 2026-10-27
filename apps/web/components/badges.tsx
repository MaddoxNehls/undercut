import type { CollectorKind, JobStatus, ObservationStatus } from '@undercut/core';

const STATUS: Record<ObservationStatus, { label: string; className: string; icon: string }> = {
  ok: { label: 'OK', className: 'bg-good-wash text-good', icon: 'M3 8.5l3 3 7-7' },
  blocked: { label: 'Blocked', className: 'bg-critical-wash text-critical', icon: 'M4 4l8 8M12 4l-8 8' },
  parse_error: { label: 'Parse error', className: 'bg-warning-wash text-warning', icon: 'M8 3v6M8 12v1' },
};

/** Observation outcome: always icon + label, never color alone. */
export function StatusPill({ status }: { status: ObservationStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.className}`}>
      <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
        <path d={s.icon} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {s.label}
    </span>
  );
}

const JOB_STATUS: Record<JobStatus, string> = {
  queued: 'text-ink-2',
  leased: 'text-accent',
  done: 'text-good',
  failed: 'text-critical',
  skipped: 'text-warning',
};

export function JobStatusLabel({ status }: { status: JobStatus }) {
  return <span className={`font-semibold capitalize ${JOB_STATUS[status]}`}>{status === 'leased' ? 'In progress' : status}</span>;
}

/** Where collection runs: the cloud fleet, or a local collector on a home connection. */
export function RouteBadge({ route, learned = false }: { route: CollectorKind; learned?: boolean }) {
  const isLocal = route === 'local';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        isLocal ? 'border-ink bg-ink text-surface' : 'border-rule-strong text-ink-2'
      }`}
      title={learned ? 'Chosen automatically from this site’s block rate' : 'Set on this watch'}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        {isLocal ? (
          <path d="M2 8l6-5 6 5v6H10v-4H6v4H2z" fill="currentColor" />
        ) : (
          <path d="M4.5 12.5h7.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 3.8 7.6 2.5 2.5 0 0 0 4.5 12.5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
      {isLocal ? 'Local' : 'Cloud'}
      {learned && <span className="opacity-70">· auto</span>}
    </span>
  );
}
