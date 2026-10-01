/** Receipt routes: issue, list, view, reprint. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import { createReceiptForTransaction, getReceipt, listReceipts, reprintReceipt } from '../services/receipts.js';

const router = Router();

router.get('/', requirePermission('receipt.print'), (req, res) => {
  const q = parse(
    z.object({
      q: z.string().optional().default(''),
      from: zBizDate.optional(),
      to: zBizDate.optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(listReceipts(q));
});

router.get('/:id', requirePermission('receipt.print'), (req, res) => {
  res.json(getReceipt(req.params.id));
});

router.post('/:id/print', requirePermission('receipt.print'), (req, res) => {
  res.json(reprintReceipt(req.params.id));
});

router.post('/transaction/:txnId', requirePermission('receipt.print'), (req, res) => {
  res.status(201).json(createReceiptForTransaction(Number(req.params.txnId), req.user, req.ip));
});

export default router;
