'use client';

import { relativeTime } from '@/lib/format';

const ABSOLUTE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Renders a timestamp in the viewer's time zone. The server's render may differ in zone,
 * so hydration warnings are suppressed for the text only.
 */
export function LocalTime({ date, mode = 'absolute' }: { date: Date | string; mode?: 'absolute' | 'relative' }) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const absolute = ABSOLUTE.format(d);
  return (
    <time dateTime={d.toISOString()} title={absolute} suppressHydrationWarning>
      {mode === 'relative' ? relativeTime(d) : absolute}
    </time>
  );
}
