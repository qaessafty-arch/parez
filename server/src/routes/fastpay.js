/**
 * FastPay module routes — dedicated section for FastPay operations.
 * All records are real transactions (service_code = fastpay).
 */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate, zReference } from '../lib/validate.js';
import { createTransaction, listTransactions, getTransaction } from '../services/transactions.js';
import { walletSummary, walletAccount } from '../services/wallets.js';
import { createReceiptForTransaction } from '../services/receipts.js';
import { resolveRange } from '../lib/dates.js';

const router = Router();
router.use(requirePermission('transaction.view'));

router.get('/summary', (req, res) => {
  const q = parse(
    z.object({
      range: z.string().default('today'),
      from: zBizDate.optional(),
      to: zBizDate.optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.query
  );
  res.json(walletSummary('fastpay', q));
});

router.get('/account', (req, res) => {
  const acct = walletAccount('fastpay');
  res.json({ account: acct });
});

router.get('/transactions', (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(), range: z.string().optional(),
      status: z.string().optional(), q: z.string().optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  const { range, ...rest } = q;
  let span = {};
  if (range && !q.from && !q.to) {
    const r = resolveRange(range);
    span = { from: r.from, to: r.to };
  }
  res.json(listTransactions({ ...rest, ...span, service_code: 'fastpay' }));
});

router.post('/transactions', requirePermission('transaction.create'), (req, res) => {
  const body = parse(
    z.object({
      type_code: z.string(),
      customer_id: z.coerce.number().int().nullable().optional(),
      account_id: z.coerce.number().int().optional(),
      amount: z.union([z.string(), z.number()]),
      currency: z.enum(['IQD', 'USD']).default('IQD'),
      commission: z.union([z.string(), z.number()]).nullable().optional(),
      payment_method: z.string().max(30).optional(),
      wallet_number: z.string().trim().max(60).optional().nullable(),
      reference_no: zReference.optional(),
      description: z.string().trim().max(500).optional().nullable(),
      biz_date: zBizDate.optional(),
      status: z.enum(['pending', 'completed']).optional(),
      force: z.boolean().optional(),
      force_reason: z.string().trim().max(300).optional(),
      receipt: z.boolean().optional(),
    }),
    req.body
  );
  const defaultAccount = walletAccount('fastpay');
  const { receipt, ...input } = body;
  const saved = createTransaction(
    { ...input, service_code: 'fastpay', account_id: input.account_id || defaultAccount.id },
    req.user,
    req.ip
  );
  const receiptRow = receipt === false ? null : createReceiptForTransaction(saved.id, req.user, req.ip, { silentDuplicate: true });
  res.status(201).json({ transaction: getTransaction(saved.id), receipt: receiptRow });
});

export default router;
