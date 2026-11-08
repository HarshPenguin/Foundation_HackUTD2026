import type { Timestamp } from 'spacetimedb';

export const MICROS = 1_000_000;

export function usd(micros: bigint | number, digits = 2): string {
  const n = Number(micros) / MICROS;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function toMicros(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars < 0) return 0n;
  return BigInt(Math.round(dollars * MICROS));
}

export function toDollars(micros: bigint | number): number {
  return Number(micros) / MICROS;
}

export function tsDate(t: Timestamp | undefined | null): Date | null {
  if (!t) return null;
  return t.toDate();
}

export function tsMs(t: Timestamp | undefined | null): number {
  return t ? Number(t.microsSinceUnixEpoch / 1000n) : 0;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_NAMES = WEEKDAYS;
export const weekdayName = (d: number) => WEEKDAYS[d] ?? 'Sunday';

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${suffix}`;
}

/** "Wednesday at 12 PM" (or "today at 9 AM" / "tomorrow at ..."). */
export function whenLabel(d: Date | null): string {
  if (!d) return 'not scheduled';
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const time = d.getMinutes()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : hourLabel(d.getHours());
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getDay()]} at ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

export function ago(d: Date | null): string {
  if (!d) return 'never';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function clockTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function shortDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const CADENCE_LABEL: Record<string, string> = {
  on_demand: 'On demand',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

export function cadenceLabel(cadence: string, runDay: number, runHour: number): string {
  switch (cadence) {
    case 'daily':
      return `Daily at ${hourLabel(runHour)}`;
    case 'weekly':
      return `${weekdayName(runDay)}s at ${hourLabel(runHour)}`;
    case 'monthly':
      return `Monthly on day ${runDay}, ${hourLabel(runHour)}`;
    case 'quarterly':
      return `Quarterly on day ${runDay}, ${hourLabel(runHour)}`;
    default:
      return 'On demand';
  }
}

export function sentence(s: string): string {
  if (!s) return s;
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
