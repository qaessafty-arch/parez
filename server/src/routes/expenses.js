/** Expense routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import {
  recordExpense, listExpenses, getExpense, updateExpense,
  listExpenseCategories, createExpenseCategory,
} from '../services/expenses.js';

const router = Router();

router.use(requirePermission('expense.view'));

router.get('/categories', (req, res) => {
  res.json({ categories: listExpenseCategories({ includeInactive: req.query.all === '1' }) });
});

router.post('/categories', requirePermission('expense.create'), (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(60), code: z.string().trim().max(40).optional() }), req.body);
  res.status(201).json(createExpenseCategory(body, req.user, req.ip));
});

router.get('/', (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(),
      category_id: z.coerce.number().int().optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
      q: z.string().optional().default(''),
      limit: z.coerce.number().int().min(1).max(300).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(listExpenses(q));
});

router.post('/', requirePermission('expense.create'), (req, res) => {
  const body = parse(
    z.object({
      category_id: z.coerce.number().int(),
      description: z.string().trim().min(2).max(300),
      amount: z.union([z.string(), z.number()]),
      currency: z.enum(['IQD', 'USD']).default('IQD'),
      account_id: z.coerce.number().int().optional(),
      payment_method: z.string().max(30).optional(),
      supplier: z.string().trim().max(120).optional().default(''),
      receipt_no: z.string().trim().max(60).optional().default(''),
      notes: z.string().trim().max(500).optional().default(''),
      biz_date: zBizDate.optional(),
      force: z.boolean().optional(),
      force_reason: z.string().trim().max(300).optional(),
    }),
    req.body
  );
  res.status(201).json(recordExpense(body, req.user, req.ip));
});

router.get('/:id', (req, res) => {
  res.json(getExpense(req.params.id));
});

router.patch('/:id', requirePermission('expense.edit'), (req, res) => {
  const body = parse(
    z.object({
      category_id: z.coerce.number().int().optional(),
      description: z.string().trim().min(2).max(300).optional(),
      supplier: z.string().trim().max(120).optional(),
      receipt_no: z.string().trim().max(60).optional(),
      notes: z.string().trim().max(500).optional(),
      amount: z.union([z.string(), z.number()]).optional(),
      account_id: z.coerce.number().int().optional(),
      biz_date: zBizDate.optional(),
      reason: z.string().trim().max(300).optional(),
    }),
    req.body
  );
  res.json(updateExpense(Number(req.params.id), body, req.user, req.ip));
});

export default router;
