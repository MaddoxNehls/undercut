'use client';

import { formatPrice } from '@undercut/core';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface ChartPoint {
  /** Epoch milliseconds of the observation's as-of time. */
  t: number;
  price: number;
  collectorKind: 'cloud' | 'local';
}

export interface ChartSeries {
  id: string;
  label: string;
  points: readonly ChartPoint[];
}

export interface ChartFailure {
  t: number;
  status: 'blocked' | 'parse_error';
  reason: string | null;
}

const HEIGHT = 300;
const M = { top: 16, right: 84, bottom: 44, left: 64 };
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;
const MAX_SERIES = SERIES_COLORS.length;
const TIME_STEPS = [5, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080, 20160, 43200].map((m) => m * 60_000);

/**
 * Price history as a line per variant over time. Hover (or arrow keys) snaps a crosshair to the
 * nearest check and lists every variant's price there; failed checks sit as ticks under the axis.
 */
export function PriceChart(props: { series: readonly ChartSeries[]; failures: readonly ChartFailure[]; currency: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Measured on the client; rendering waits for it so time labels use the viewer's zone (no hydration mismatch).
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-[300px]">
      {width !== null && <Plot {...props} width={width} />}
    </div>
  );
}

function Plot({ series, failures, currency, width }: {
  series: readonly ChartSeries[];
  failures: readonly ChartFailure[];
  currency: string | null;
  width: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const shown = series.slice(0, MAX_SERIES).filter((s) => s.points.length > 0);
  const allPoints = shown.flatMap((s) => s.points);
  const times = [...new Set(allPoints.map((p) => p.t))].sort((a, b) => a - b);
  const fmt = (v: number) => formatPrice(v, currency);

  if (allPoints.length === 0) {
    return (
      <div className="flex h-[300px] flex-col items-center justify-center rounded-md border border-dashed border-rule-strong text-center">
        <p className="font-medium">No prices recorded yet</p>
        <p className="mt-1 max-w-sm text-sm text-ink-2">
          {failures.length > 0
            ? `${failures.length} ${failures.length === 1 ? 'check' : 'checks'} ran but found no price. See the log below.`
            : 'The chart fills in as checks complete.'}
        </p>
      </div>
    );
  }

  // X: span of every check, padded so a single check still has room.
  const allTimes = [...times, ...failures.map((f) => f.t)];
  let [x0, x1] = [Math.min(...allTimes), Math.max(...allTimes)];
  if (x1 - x0 < 60 * 60_000) {
    const mid = (x0 + x1) / 2;
    [x0, x1] = [mid - 30 * 60_000, mid + 30 * 60_000];
  }
  const prices = allPoints.map((p) => p.price);
  const yTicks = niceTicks(Math.min(...prices), Math.max(...prices));
  const [y0, y1] = [yTicks[0]!, yTicks[yTicks.length - 1]!];

  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const x = (t: number) => M.left + ((t - x0) / (x1 - x0)) * plotW;
  const y = (v: number) => M.top + (1 - (v - y0) / (y1 - y0)) * plotH;
  const xTicks = timeTicks(x0, x1, Math.max(2, Math.floor(plotW / 110)));
  const dense = allPoints.length > 60;

  const activeTime = active === null ? null : times[active] ?? null;
  const readout =
    activeTime === null
      ? []
      : shown.flatMap((s, i) => {
          const nearest = nearestPoint(s.points, activeTime);
          return nearest && Math.abs(nearest.t - activeTime) <= (x1 - x0) * 0.02 ? [{ series: s, color: SERIES_COLORS[i]!, point: nearest }] : [];
        });

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = x0 + ((e.clientX - box.left - M.left) / plotW) * (x1 - x0);
    setActive(nearestIndex(times, t));
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    setActive((i) => Math.min(times.length - 1, Math.max(0, (i ?? (step > 0 ? -1 : times.length)) + step)));
  };

  const tooltipLeft = activeTime === null ? 0 : x(activeTime);
  const flip = tooltipLeft > width - 220;

  return (
    <>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-labelledby={titleId}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="block touch-none select-none focus-visible:outline-offset-4"
      >
        <title id={titleId}>
          {`Price history: ${allPoints.length} prices from ${new Date(x0).toLocaleDateString()} to ${new Date(x1).toLocaleDateString()}. Use arrow keys to step through checks.`}
        </title>

        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={M.left - 10} y={y(v)} dy="0.32em" textAnchor="end" className="figure fill-muted text-[11px]">
              {compactPrice(v, currency)}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--axis)" strokeWidth={1} />
        {xTicks.map((t) => (
          <text key={t.t} x={x(t.t)} y={M.top + plotH + 30} textAnchor="middle" className="fill-muted text-[11px]">
            {t.label}
          </text>
        ))}

        {failures.map((f, i) => (
          <line
            key={`${f.t}-${i}`}
            x1={x(f.t)}
            x2={x(f.t)}
            y1={M.top + plotH + 4}
            y2={M.top + plotH + 12}
            stroke={f.status === 'blocked' ? 'var(--critical)' : 'var(--warning)'}
            strokeWidth={2}
            strokeLinecap="round"
          >
            <title>{`${f.status === 'blocked' ? 'Blocked' : 'Parse error'}${f.reason ? `: ${f.reason}` : ''}`}</title>
          </line>
        ))}

        {shown.length === 1 && shown[0]!.points.length > 1 && (
          <path d={areaPath(shown[0]!.points, x, y, M.top + plotH)} fill="var(--series-1)" opacity={0.1} />
        )}
        {shown.map((s, i) => (
          <g key={s.id}>
            <path d={linePath(s.points, x, y)} fill="none" stroke={SERIES_COLORS[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {(dense ? s.points.slice(-1) : s.points).map((p) => (
              <circle key={p.t} cx={x(p.t)} cy={y(p.price)} r={4} fill={SERIES_COLORS[i]} stroke="var(--surface)" strokeWidth={2} />
            ))}
            <EndLabel point={s.points[s.points.length - 1]!} x={x} y={y} text={fmt(s.points[s.points.length - 1]!.price)} />
          </g>
        ))}

        {activeTime !== null && (
          <g pointerEvents="none">
            <line x1={x(activeTime)} x2={x(activeTime)} y1={M.top} y2={M.top + plotH} stroke="var(--ink-2)" strokeWidth={1} />
            {readout.map((r) => (
              <circle key={r.series.id} cx={x(r.point.t)} cy={y(r.point.price)} r={6} fill={r.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>

      {activeTime !== null && readout.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-md border border-rule bg-surface px-3 py-2 text-sm shadow-[0_4px_16px_rgb(0_0_0/0.08)]"
          style={flip ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }}
        >
          <div className="mb-1 text-xs text-muted">{new Date(activeTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
          {readout.map((r) => (
            <div key={r.series.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
              <span className="figure text-base font-semibold">{fmt(r.point.price)}</span>
              <span className="text-xs text-ink-2">
                {shown.length > 1 ? `${r.series.label}, ` : ''}
                {r.point.collectorKind === 'local' ? 'local collector' : 'cloud'}
              </span>
            </div>
          ))}
        </div>
      )}

      <Legend series={shown} failures={failures} />
      {series.length > MAX_SERIES && (
        <p className="mt-1 text-xs text-muted">Showing the first {MAX_SERIES} of {series.length} variants.</p>
      )}
    </>
  );
}

function EndLabel({ point, x, y, text }: { point: ChartPoint; x: (t: number) => number; y: (v: number) => number; text: string }) {
  return (
    <text x={x(point.t) + 10} y={y(point.price)} dy="0.32em" className="figure fill-ink text-[12px] font-semibold">
      {text}
    </text>
  );
}

function Legend({ series, failures }: { series: readonly ChartSeries[]; failures: readonly ChartFailure[] }) {
  const blocked = failures.some((f) => f.status === 'blocked');
  const parseErrors = failures.some((f) => f.status === 'parse_error');
  if (series.length < 2 && !blocked && !parseErrors) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-16 text-xs text-ink-2">
      {series.length >= 2 &&
        series.map((s, i) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} />
            {s.label}
          </span>
        ))}
      {blocked && <FailureKey color="var(--critical)" label="Blocked check" />}
      {parseErrors && <FailureKey color="var(--warning)" label="Parse error" />}
    </div>
  );
}

function FailureKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="4" height="10" aria-hidden="true">
        <line x1="2" x2="2" y1="1" y2="9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

function linePath(points: readonly ChartPoint[], x: (t: number) => number, y: (v: number) => number): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
}

function areaPath(points: readonly ChartPoint[], x: (t: number) => number, y: (v: number) => number, base: number): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points, x, y)}L${x(last.t).toFixed(1)},${base}L${x(first.t).toFixed(1)},${base}Z`;
}

function nearestIndex(sorted: readonly number[], t: number): number | null {
  if (sorted.length === 0) return null;
  let best = 0;
  for (let i = 1; i < sorted.length; i++) if (Math.abs(sorted[i]! - t) < Math.abs(sorted[best]! - t)) best = i;
  return best;
}

function nearestPoint(points: readonly ChartPoint[], t: number): ChartPoint | undefined {
  let best: ChartPoint | undefined;
  for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}

/** 4–6 round ticks covering [min, max]; a flat series gets a band around its value. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, 1);
    [min, max] = [Math.max(0, min - pad), max + pad];
  }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function timeTicks(x0: number, x1: number, maxTicks: number): { t: number; label: string }[] {
  const step = TIME_STEPS.find((s) => (x1 - x0) / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1]!;
  const offset = new Date(x0).getTimezoneOffset() * 60_000;
  const start = Math.ceil((x0 - offset) / step) * step + offset;
  const daily = step >= 86_400_000;
  const ticks: { t: number; label: string }[] = [];
  let lastDay = '';
  for (let t = start; t <= x1; t += step) {
    const d = new Date(t);
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    ticks.push({ t, label: daily ? day : day !== lastDay ? `${day}, ${time}` : time });
    lastDay = day;
  }
  return ticks;
}

function compactPrice(v: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('en-US', {
      ...(currency ? { style: 'currency', currency } : {}),
      notation: v >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: v >= 100 ? 0 : 2,
    }).format(v);
  } catch {
    return String(v);
  }
}
