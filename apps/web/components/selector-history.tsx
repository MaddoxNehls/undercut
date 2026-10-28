import { formatPrice, ruleToText } from '@undercut/core';
import type { SelectorChange } from '@undercut/db';
import { LocalTime } from './local-time';

const TRIGGER: Record<SelectorChange['trigger'], string> = { created: 'Created', edited: 'Edited', healed: 'Self-healed' };
const SOURCE: Record<SelectorChange['source'], string> = {
  user: 'you',
  'json-ld': 'JSON-LD',
  microdata: 'microdata',
  opengraph: 'OpenGraph',
  'class-pattern': 'class pattern',
  llm: 'LLM',
};
const STATUS: Record<SelectorChange['status'], { label: string; tone: string }> = {
  applied: { label: 'Applied', tone: 'text-good' },
  accepted: { label: 'Accepted by you', tone: 'text-good' },
  proposed: { label: 'Needs review', tone: 'text-warning' },
  rejected: { label: 'Rejected', tone: 'text-muted' },
};

/** Every change to the extraction rule, with the value it read before and after. */
export function SelectorHistory({ changes, currency }: { changes: SelectorChange[]; currency: string | null }) {
  const value = (v: number | null) => (v === null ? '—' : formatPrice(v, currency));
  return (
    <section aria-labelledby="selector-history-heading" className="mt-10">
      <h2 id="selector-history-heading" className="mb-1 text-lg font-semibold">
        Selector history
      </h2>
      <p className="mb-3 max-w-2xl text-sm text-ink-2">
        When a site redesign breaks the selector three checks in a row, Undercut re-derives it from the page. It applies the new one on its own
        only if it reads the same kind of price within 15% of the last known value.
      </p>
      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-rule text-left text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Change</th>
              <th className="px-3 py-2 font-medium">Selector</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {changes.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <LocalTime date={c.createdAt} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {TRIGGER[c.trigger]}
                  <span className="block text-xs text-muted">by {SOURCE[c.source]}</span>
                </td>
                <td className="px-3 py-2.5">
                  {c.oldRule && <code className="block text-[12px] text-muted line-through">{ruleToText(c.oldRule)}</code>}
                  <code className="block text-[12px]">{ruleToText(c.newRule)}</code>
                </td>
                <td className="figure px-3 py-2.5 text-right whitespace-nowrap">
                  {c.trigger === 'healed' ? (
                    <>
                      <span className="text-muted">{value(c.oldValue)}</span> → <span className="font-semibold">{value(c.newValue)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`font-medium ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span>
                  {c.reason && <span className="block max-w-xs text-xs text-ink-2">{c.reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
