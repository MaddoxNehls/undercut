/** Tiny trend line for list rows; the last point is marked so "now" is legible. */
export function Sparkline({ values, width = 120, height = 32 }: { values: readonly number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="flex items-center text-xs text-muted" aria-hidden="true">{values.length ? '' : '—'}</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1]!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend over ${values.length} checks`}>
      <polyline points={points} fill="none" stroke="var(--series-1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  );
}
