/** Display formatting + parsing helpers. All *_minor values are integer minor units. */

export function fmtMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  const majorStr = major.toLocaleString('en-US');
  const body = cents === 0 ? majorStr : `${majorStr}.${String(cents).padStart(2, '0')}`;
  return `${sign}${body} ${currency}`;
}

/** Parse a user-typed display amount ("1,250.50") into minor units. Null when invalid. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const cleaned = String(input).replace(/[, \u066c]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function amountDisplay(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  const cents = Math.abs(minor) % 100;
  const major = Math.floor(Math.abs(minor) / 100);
  const s = major.toLocaleString('en-US') + (cents === 0 ? '' : `.${String(cents).padStart(2, '0')}`);
  return minor < 0 ? `-${s}` : s;
}

export function todayISO(): string {
  // ponytail: uses Intl for correct Iraq time; upgrade to user-configurable TZ if multi-region
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso;
}

export function fileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
