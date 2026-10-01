/**
 * Dates — Iraq/Kurdistan local time (Asia/Baghdad, UTC+3, no DST).
 * Business dates are stored as 'YYYY-MM-DD' in local time.
 * Timestamps are stored as UTC ISO-8601 ('YYYY-MM-DDTHH:MM:SSZ').
 */

export const TZ = 'Asia/Baghdad';
export const UTC_OFFSET_HOURS = 3;

const baghdadFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function parts(date = new Date()) {
  const p = {};
  for (const { type, value } of baghdadFormatter.formatToParts(date)) p[type] = value;
  if (p.hour === '24') p.hour = '00';
  return p;
}

/** Local business date string: 2026-09-30 */
export function today(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local time string: 13:45 */
export function nowTime(date = new Date()) {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

/** UTC ISO timestamp for DB storage */
export function nowIso(date = new Date()) {
  return date.toISOString();
}

/** Full local date-time parts */
export function localParts(date = new Date()) {
  const p = parts(date);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, timeSeconds: `${p.hour}:${p.minute}:${p.second}` };
}

export function isValidBizDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function yesterday(dateStr = today()) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Weekday (0=Sunday..6=Saturday) of a business date */
export function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/**
 * Range resolution for dashboard/reports.
 * @returns {{from: string, to: string, label: string}}
 */
export function resolveRange(range, ref = today(), custom = {}) {
  switch (range) {
    case 'today':
      return { from: ref, to: ref, label: 'today' };
    case 'yesterday':
      return { from: yesterday(ref), to: yesterday(ref), label: 'yesterday' };
    case 'week': { // Saturday..Friday (Iraq week starts Saturday)
      const w = weekday(ref); // 0=Sun ... 6=Sat
      const back = (w + 1) % 7; // days since Saturday
      const from = addDays(ref, -back);
      return { from, to: ref, label: 'week' };
    }
    case 'month':
      return { from: `${ref.slice(0, 7)}-01`, to: ref, label: 'month' };
    case 'last_month': {
      const y = Number(ref.slice(0, 4));
      const m = Number(ref.slice(5, 7));
      const startM = m === 1 ? 12 : m - 1;
      const startY = m === 1 ? y - 1 : y;
      const from = `${startY}-${String(startM).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(startY, startM, 0)).getUTCDate();
      const to = `${startY}-${String(startM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from, to, label: 'last_month' };
    }
    case 'custom': {
      const from = custom.from || ref;
      const to = custom.to || ref;
      if (!isValidBizDate(from) || !isValidBizDate(to)) throw new Error('Invalid date range');
      if (from > to) throw new Error('Invalid date range: from is after to');
      return { from, to, label: 'custom' };
    }
    default:
      return { from: ref, to: ref, label: 'today' };
  }
}

/** Display helpers used by both server exports and client */
export function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = dateStr.split('-');
  return `${d} ${months[Number(m) - 1]} ${y}`;
}
