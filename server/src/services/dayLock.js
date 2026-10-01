/** Day lock — once a day is closed, its ledger history cannot be altered silently. */
import { getDb } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

export function latestClosing(conn, currency) {
  const db = conn || getDb();
  return db
    .prepare('SELECT * FROM daily_closings WHERE currency = ? ORDER BY closing_date DESC LIMIT 1')
    .get(currency);
}

export function isDayClosed(conn, biz_date, currency) {
  const closing = latestClosing(conn, currency);
  return !!closing && closing.closing_date >= biz_date;
}

export function assertDayOpen(conn, biz_date, currency, action = 'This operation') {
  if (!biz_date || !currency) return;
  const closing = latestClosing(conn, currency);
  if (closing && closing.closing_date >= biz_date) {
    throw badRequest(
      'DAY_CLOSED',
      `${action} is not allowed on or before the closed day ${closing.closing_date} (${currency}). Reopen that day as admin to correct it.`
    );
  }
}
