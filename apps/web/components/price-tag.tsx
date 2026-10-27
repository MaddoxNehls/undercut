import type { ReactNode } from 'react';

/** The latest price on a notched tag: the one loud element on a watch page. */
export function PriceTag({ parts, caption }: { parts: { prefix: string; amount: string; suffix: string } | null; caption: ReactNode }) {
  return (
    <div className="relative inline-flex shrink-0 flex-col items-start self-start bg-tag py-4 pr-7 pl-11 text-tag-ink [clip-path:polygon(24px_0,100%_0,100%_100%,24px_100%,0_50%)]">
      <span aria-hidden="true" className="absolute top-1/2 left-[19px] size-2.5 -translate-y-1/2 rounded-full bg-paper" />
      {parts ? (
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          {parts.prefix && <span className="text-lg font-medium">{parts.prefix}</span>}
          <span className="figure text-5xl leading-none font-bold">{parts.amount}</span>
          {parts.suffix && <span className="text-lg font-medium">{parts.suffix}</span>}
        </span>
      ) : (
        <span className="text-2xl font-bold">No price yet</span>
      )}
      <span className="mt-2 text-sm">{caption}</span>
    </div>
  );
}
