/**
 * Number and date formatting helpers.
 */

export const fmtCurrency = (value: number | string | null | undefined, decimals = 0): string => {
  const n = Number(value);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

export const fmtPct = (value: number | string | null | undefined, decimals = 1): string => {
  const n = Number(value);
  if (isNaN(n)) return '—';
  return `${n.toFixed(decimals)}%`;
};

export const fmtNumber = (value: number | string | null | undefined, decimals = 0): string => {
  const n = Number(value);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
};

export const fmtDate = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
};

export const fmtRelative = (value: string | Date | null | undefined): string => {
  if (!value) return '—';
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(value);
};

export const yoyChange = (current: number | null, prior: number | null): number | null => {
  if (current == null || prior == null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
};

export const fmtYoy = (pct: number | null): string => {
  if (pct == null) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
};
