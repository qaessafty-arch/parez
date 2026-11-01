/**
 * Dealer inventory routes — wholesale purchases, retail sales, adjustments.
 *
 * The service functions are async and take camelCase fields plus `user` and
 * `ip` in the same object, so every handler awaits them and maps the request
 * body explicitly. Amounts arrive as integer minor units (value * 100).
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

const accountCode = z.enum(['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE']);
const currency = z.enum(['IQD', 'USD']).default('IQD');
const minorUnits = z.coerce.number().int().min(0);
const notes = z.string().trim().max(500).optional().nullable();

// List all dealer inventory (admin view)
router.get('/', requirePermission('transaction.view'), async (req, res) => {
  res.json(await listInventory());
});

// Summary for closing
router.get('/summary', requirePermission('transaction.view'), async (req, res) => {
  const q = parse(z.object({ date: zBizDate.optional() }), req.query);
  res.json(await getDealerInventorySummary(q.date || undefined));
});

// Get inventory for specific account
router.get('/:accountCode', requirePermission('transaction.view'), async (req, res) => {
  const q = parse(z.object({ currency: z.enum(['IQD', 'USD']).optional() }), req.query);
  const inv = await getInventoryByAccountCode(req.params.accountCode, q.currency);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory not found' } });
  res.json({ inventory: inv });
});

// Get movements for an inventory
router.get('/:accountCode/movements', requirePermission('transaction.view'), async (req, res) => {
  const q = parse(
    z.object({
      currency: z.enum(['IQD', 'USD']).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  const inv = await getInventoryByAccountCode(req.params.accountCode, q.currency);
  if (!inv) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inventory not found' } });
  res.json(await getMovements(inv.id, { limit: q.limit, offset: q.offset }));
});

// Record wholesale purchase (buy stock)
router.post('/purchase', requirePermission('transaction.create'), async (req, res) => {
  const body = parse(
    z.object({
      account_code: accountCode,
      currency,
      qty: z.coerce.number().int().min(1),
      unit_cost_minor: minorUnits,
      reference_txn_id: z.coerce.number().int().optional().nullable(),
      notes,
    }),
    req.body
  );
  res.status(201).json(
    await recordPurchase({
      accountCode: body.account_code,
      currency: body.currency,
      qty: body.qty,
      unitCostMinor: body.unit_cost_minor,
      referenceTxnId: body.reference_txn_id,
      notes: body.notes,
      user: req.user,
      ip: req.ip,
    })
  );
});

// Record retail sale (sell stock)
router.post('/sale', requirePermission('transaction.create'), async (req, res) => {
  const body = parse(
    z.object({
      account_code: accountCode,
      currency,
      qty: z.coerce.number().int().min(1),
      unit_price_minor: minorUnits,
      reference_txn_id: z.coerce.number().int().optional().nullable(),
      notes,
    }),
    req.body
  );
  res.status(201).json(
    await recordSale({
      accountCode: body.account_code,
      currency: body.currency,
      qty: body.qty,
      unitPriceMinor: body.unit_price_minor,
      referenceTxnId: body.reference_txn_id,
      notes: body.notes,
      user: req.user,
      ip: req.ip,
    })
  );
});

// Manual adjustment
router.post('/adjust', requirePermission('transaction.edit'), async (req, res) => {
  const body = parse(
    z.object({
      account_code: accountCode,
      currency,
      qty_change: z.coerce.number().int().refine((v) => v !== 0, 'Qty change cannot be zero'),
      unit_cost_minor: minorUnits.optional().nullable(),
      unit_price_minor: minorUnits.optional().nullable(),
      notes,
    }),
    req.body
  );
  res.status(201).json(
    await recordAdjustment({
      accountCode: body.account_code,
      currency: body.currency,
      qtyChange: body.qty_change,
      unitCostMinor: body.unit_cost_minor ?? undefined,
      unitPriceMinor: body.unit_price_minor ?? undefined,
      notes: body.notes,
      user: req.user,
      ip: req.ip,
    })
  );
});

export default router;
