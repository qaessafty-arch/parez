/** Central transaction routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate, zReference } from '../lib/validate.js';
import {
  createTransaction, listTransactions, getTransaction, updateTransaction,
  reverseTransaction, cancelTransaction, refundTransaction, rangeSummary,
} from '../services/transactions.js';
import { createReceiptForTransaction } from '../services/receipts.js';
import { resolveRange } from '../lib/dates.js';

const router = Router();

const createSchema = z.object({
  service_code: z.string().optional(),
  service_id: z.coerce.number().int().optional(),
  type_code: z.string().optional(),
  type_id: z.coerce.number().int().optional(),
  customer_id: z.coerce.number().int().nullable().optional(),
  account_id: z.coerce.number().int(),
  counter_account_id: z.coerce.number().int().nullable().optional(),
  direction: z.enum(['in', 'out']).optional(),
  // amount / commission are entered in display units (decimal string or number);
  // the service converts them to integer minor units exactly once.
  amount: z.union([z.string(), z.number()]),
  currency: z.enum(['IQD', 'USD']).default('IQD'),
  commission: z.union([z.string(), z.number()]).nullable().optional(),
  payment_method: z.string().max(30).optional(),
  wallet_number: z.string().trim().max(60).optional().nullable(),
  reference_no: zReference.optional(),
  description: z.string().trim().max(500).optional().nullable(),
  biz_date: zBizDate.optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(['pending', 'completed']).optional(),
  fx_rate: z.string().regex(/^\d+(\.\d{1,6})?$/).optional().nullable(),
  fx_currency: z.enum(['IQD', 'USD']).optional().nullable(),
  force: z.boolean().optional(),
  force_reason: z.string().trim().max(300).optional(),
  receipt: z.boolean().optional(),
});

router.get('/', requirePermission('transaction.view'), async (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(), range: z.string().optional(),
      service_code: z.string().optional(), type_code: z.string().optional(),
      customer_id: z.coerce.number().int().optional(), account_id: z.coerce.number().int().optional(),
      currency: z.enum(['IQD', 'USD']).optional(), status: z.string().optional(),
      direction: z.enum(['in', 'out', 'transfer', 'none']).optional(),
      created_by: z.coerce.number().int().optional(),
      q: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  let { range, ...rest } = q;
  if (range && !q.from && !q.to) {
    const r = resolveRange(range);
    rest = { ...rest, from: r.from, to: r.to };
  }
  res.json(await listTransactions(rest));
});

router.get('/summary', requirePermission('transaction.view'), async (req, res) => {
  const q = parse(
    z.object({
      range: z.string().default('today'),
      from: zBizDate.optional(), to: zBizDate.optional(),
      service_code: z.string().optional(), currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.query
  );
  const r = q.from && q.to ? { from: q.from, to: q.to } : resolveRange(q.range);
  res.json({ from: r.from, to: r.to, rows: await rangeSummary(r.from, r.to, q) });
});

router.post('/', requirePermission('transaction.create'), async (req, res) => {
  const body = parse(createSchema, req.body);
  const { receipt, ...input } = body;
  const saved = await createTransaction(input, req.user, req.ip);
  let receiptRow = null;
  if (receipt !== false) {
    receiptRow = await createReceiptForTransaction(saved.id, req.user, req.ip, { silentDuplicate: true });
  }
  res.status(201).json({ transaction: await getTransaction(saved.id), receipt: receiptRow });
});

router.get('/:id', requirePermission('transaction.view'), async (req, res) => {
  res.json(await getTransaction(req.params.id));
});

router.patch('/:id', requirePermission('transaction.edit'), async (req, res) => {
  const body = parse(
    z.object({
      amount: z.union([z.string(), z.number()]).optional(),
      commission: z.union([z.string(), z.number()]).optional(),
      reference_no: zReference.optional(),
      description: z.string().trim().max(500).optional().nullable(),
      wallet_number: z.string().trim().max(60).optional().nullable(),
      biz_date: zBizDate.optional(),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      payment_method: z.string().max(30).optional(),
      account_id: z.coerce.number().int().optional(),
      counter_account_id: z.coerce.number().int().nullable().optional(),
      customer_id: z.coerce.number().int().nullable().optional(),
      status: z.enum(['pending', 'completed']).optional(),
      reason: z.string().trim().max(300).optional(),
    }),
    req.body
  );
  await updateTransaction(Number(req.params.id), body, req.user, req.ip);
  res.json(await getTransaction(req.params.id));
});

router.post('/:id/reverse', requirePermission('transaction.reverse'), async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const result = await reverseTransaction(Number(req.params.id), body, req.user, req.ip);
  res.json(result);
});

router.post('/:id/cancel', requirePermission('transaction.cancel'), async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  res.json(await cancelTransaction(Number(req.params.id), body, req.user, req.ip));
});

router.post('/:id/refund', requirePermission('transaction.reverse'), async (req, res) => {
  const body = parse(
    z.object({
      reason: z.string().trim().min(3).max(300),
      amount: z.union([z.string(), z.number()]).optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.body
  );
  res.json(await refundTransaction(Number(req.params.id), body, req.user, req.ip));
});

export default router;
