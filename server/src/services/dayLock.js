/** Day lock — once a day is closed, its ledger history cannot be altered silently. */
import { one } from '../db/index.js';
import { badRequest } from '../lib/errors.js';

export async function latestClosing(currency) {
  return one('SELECT * FROM daily_closings WHERE currency = ? ORDER BY closing_date DESC LIMIT 1', currency);
}

export async function isDayClosed(biz_date, currency) {
  const closing = await latestClosing(currency);
  return !!closing && closing.closing_date >= biz_date;
}

export async function assertDayOpen(biz_date, currency, action = 'This operation') {
  if (!biz_date || !currency) return;
  const closing = await latestClosing(currency);
  if (closing && closing.closing_date >= biz_date) {
    throw badRequest(
      'DAY_CLOSED',
      `${action} is not allowed on or before the closed day ${closing.closing_date} (${currency}). Reopen that day as admin to correct it.`
    );
  }
}
