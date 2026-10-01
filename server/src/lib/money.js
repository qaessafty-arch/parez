/**
 * Money — decimal-safe money handling.
 *
 * ALL amounts in the database are INTEGER minor units (value * 100),
 * equivalent to DECIMAL(18,2). Floating point is never used for money.
 * IQD and USD amounts are never added together — callers must group by currency.
 */

export const MINOR_SCALE = 100; // 2 decimal places for every supported currency

export class MoneyError extends Error {}

/** Parse a user/string input into integer minor units. Returns null if invalid. */
export function toMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * MINOR_SCALE);
  }
  const s = String(value).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [intPart, fracPart = ''] = s.replace('-', '').split('.');
  const frac = (fracPart + '00').slice(0, 2); // round-half-up on digit 3 handled below
  const extra = fracPart.length > 2 ? Number(fracPart[2]) : 0;
  let minor = Number(intPart) * MINOR_SCALE + Number(frac);
  if (extra >= 5) minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

/** Parse that throws a MoneyError instead of returning null. */
export function mustToMinor(value, label = 'amount') {
  const m = toMinor(value);
  if (m === null) throw new MoneyError(`Invalid ${label}: ${value}`);
  return m;
}

/** Format integer minor units as a plain decimal string, e.g. 25000000 -> "250000.00" */
export function toDecimalString(minor) {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const int = Math.floor(abs / MINOR_SCALE);
  const frac = abs % MINOR_SCALE;
  return `${neg ? '-' : ''}${int}.${String(frac).padStart(2, '0')}`;
}

/** Format with thousand separators for display: 25000000 -> "250,000.00" */
export function formatAmount(minor, { locale = 'en-US', decimals = null } = {}) {
  const showDecimals = decimals === null ? (Math.abs(minor) % MINOR_SCALE !== 0) : decimals > 0;
  const value = Math.abs(minor) / MINOR_SCALE;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(value);
  return minor < 0 ? `-${formatted}` : formatted;
}

export function addMinor(a, b) {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new MoneyError('Money overflow');
  return r;
}

export function subMinor(a, b) {
  const r = a - b;
  if (!Number.isSafeInteger(r)) throw new MoneyError('Money overflow');
  return r;
}

export function sumMinor(values) {
  return values.reduce((acc, v) => addMinor(acc, v), 0);
}

export function clampNonNegative(v) {
  return v < 0 ? 0 : v;
}

/**
 * Commission helpers. Net = amount - commission (commission is carved out of volume).
 */
export function netOf(amountMinor, commissionMinor) {
  if (commissionMinor > amountMinor) {
    throw new MoneyError('Commission cannot exceed the transaction amount');
  }
  return amountMinor - commissionMinor;
}

/**
 * Convert between currencies using a decimal-string rate.
 * Never uses float: rate is scaled by 1e6 internally with integer math.
 */
const RATE_SCALE = 1_000_000;
export function convertMinor(amountMinor, rateStr) {
  const rate = String(rateStr).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(rate)) throw new MoneyError(`Invalid exchange rate: ${rateStr}`);
  const [i, f = ''] = rate.split('.');
  const rateScaled = Number(i) * RATE_SCALE + Number((f + '000000').slice(0, 6));
  const product = amountMinor * rateScaled;
  return Math.round(product / RATE_SCALE);
}

/** Guard: assert both amounts share a currency before combining. */
export function sameCurrency(a, b) {
  if (!a || !b || a.currency !== b.currency) {
    throw new MoneyError('Cannot combine amounts in different currencies');
  }
  return a;
}
