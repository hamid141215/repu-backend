export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const RTF = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour',   24],
  ['day',     7],
  ['week',    4.345],
  ['month',  12],
  ['year', Infinity]
];

/** Human-friendly relative time in Arabic ("منذ 12 دقيقة"). */
export function relativeTimeAr(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  let diff = (Date.now() - date.getTime()) / 1000;
  for (const [unit, step] of UNITS) {
    if (Math.abs(diff) < step) return RTF.format(-Math.round(diff), unit);
    diff /= step;
  }
  return RTF.format(-Math.round(diff), 'year');
}

export function formatPercent(value: number, suffix = '٪'): string {
  return `${Math.round(value)}${suffix}`;
}
