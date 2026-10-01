/** Validation — zod wrapper producing consistent 422 responses with field details. */
import { z } from 'zod';
import { validationError } from './errors.js';
import { toMinor } from './money.js';
import { isValidBizDate } from './dates.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw validationError(details[0]?.message || 'Invalid input', details);
  }
  return result.data;
}

export const zMoney = z
  .string()
  .or(z.number())
  .transform((v, ctx) => {
    const m = toMinor(v);
    if (m === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid amount' });
      return z.NEVER;
    }
    return m;
  });

export const zMinorNonNegative = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const m = toMinor(v ?? 0);
    if (m === null || m < 0) {
      ctx.addIssue({ code: 'custom', message: 'Invalid amount' });
      return z.NEVER;
    }
    return m;
  });

export const zCurrency = z.enum(['IQD', 'USD']);
export const zBizDate = z.string().refine(isValidBizDate, { message: 'Invalid date (expected YYYY-MM-DD)' });
export const zPhone = z
  .string()
  .trim()
  .max(30)
  .regex(/^$|^[+0-9()\-\s]{6,30}$/, { message: 'Invalid phone number' })
  .optional()
  .or(z.literal(''));
export const zReference = z
  .string()
  .trim()
  .max(80)
  .regex(/^$|^[A-Za-z0-9\-\/_#. ]{1,80}$/, { message: 'Invalid reference number' })
  .optional()
  .or(z.literal(''));
export const zPositiveInt = z.number().int().positive();
export const zStatus = z.enum(['completed', 'pending', 'cancelled', 'reversed', 'refunded']);
export const zDirection = z.enum(['in', 'out', 'transfer', 'none']);

export { z };
