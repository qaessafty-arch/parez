/**
 * Dealer inventory routes — wholesale purchases, retail sales, adjustments.
 */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import {
  listInventory,
  getInventoryByAccountCode,
  recordPurchase,
  recordSale,
  recordAdjustment,
  getMovements,
  getDealerInventorySummary,
} from '../services/dealers.js';

const router = Router();

// List all dealer inventory (admin view)
router.get('/', requirePermission('transaction.view'), (req, res) => {
  res.json(listInventory());
});

// Summary for closing
router.get('/summary', requirePermission('transaction.view'), (req, res) => {
  const q = parse(
    z.object({
      date: zBizDate.optional(),
    }),
    req.query
  );
  const date = q.date || undefined;
  res.json(getDealerInventorySummary(date));
});

// Get inventory for specific account
router.get('/:accountCode', requirePermission('transaction.view'), (req, res) => {
  const q = parse(
    z.object({
      currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.query
  );
  const inv = getInventoryByAccountCode(req.params.accountCode, q.currency);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory not found' } });
  res.json({ inventory: inv });
});

// Get movements for an inventory
router.get('/:accountCode/movements', requirePermission('transaction.view'), (req, res) => {
  const q = parse(
    z.object({
      currency: z.enum(['IQD', 'USD']).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  const inv = getInventoryByAccountCode(req.params.accountCode, q.currency);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory not found' } });
  res.json(getMovements(inv.id, { limit: q.limit, offset: q.offset }));
});

// Record wholesale purchase (buy stock)
router.post('/purchase', requirePermission('transaction.create'), (req, res) => {
  const body = parse(
    z.object({
      account_code: z.enum(['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']),
      currency: z.enum(['IQD', 'USD']).default('IQD'),
      qty: z.coerce.number().int().min(1),
      unit_cost_minor: z.union([z.string(), z.number()]),
      reference_txn_id: z.coerce.number().int().optional().nullable(),
      notes: z.string().trim().max(500).optional().nullable(),
    }),
    req.body
  );
  const { account_code, ...rest } = body;
  res.status(201).json(recordPurchase({ ...rest, accountCode: account_code }, req.user, req.ip));
});

// Record retail sale (sell stock)
router.post('/sale', requirePermission('transaction.create'), (req, res) => {
  const body = parse(
    z.object({
      account_code: z.enum(['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']),
      currency: z.enum(['IQD', 'USD']).default('IQD'),
      qty: z.coerce.number().int().min(1),
      unit_price_minor: z.union([z.string(), z.number()]),
      reference_txn_id: z.coerce.number().int().optional().nullable(),
      notes: z.string().trim().max(500).optional().nullable(),
    }),
    req.body
  );
  const { account_code, ...rest } = body;
  res.status(201).json(recordSale({ ...rest, accountCode: account_code }, req.user, req.ip));
});

// Manual adjustment
router.post('/adjust', requirePermission('transaction.edit'), (req, res) => {
  const body = parse(
    z.object({
      account_code: z.enum(['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']),
      currency: z.enum(['IQD', 'USD']).default('IQD'),
      qty_change: z.coerce.number().int().refine((v) => v !== 0, 'Qty change cannot be zero'),
      unit_cost_minor: z.union([z.string(), z.number()]).optional().nullable(),
      unit_price_minor: z.union([z.string(), z.number()]).optional().nullable(),
      notes: z.string().trim().max(500).optional().nullable(),
    }),
    req.body
  );
  const { account_code, ...rest } = body;
  res.status(201).json(recordAdjustment({ ...rest, accountCode: account_code }, req.user, req.ip));
});

export default router;