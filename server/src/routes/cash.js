/** Cash management + daily closing routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import { cashSnapshot, cashMovements, allBalances } from '../services/cash.js';
import { closingPreview, closeDay, reopenDay, closingHistory } from '../services/closing.js';
import { today } from '../lib/dates.js';

export const cashRouter = Router();
cashRouter.use(requirePermission('dashboard.view'));

cashRouter.get('/snapshot', async (req, res) => {
  const q = parse(z.object({ date: zBizDate.optional() }), req.query);
  res.json(await cashSnapshot(q.date || today()));
});

cashRouter.get('/movements', async (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(200),
    }),
    req.query
  );
  res.json(await cashMovements(q));
});

cashRouter.get('/balances', async (req, res) => {
  const q = parse(z.object({ date: zBizDate.optional() }), req.query);
  res.json({ balances: await allBalances(q.date || null) });
});

export const closingRouter = Router();
closingRouter.use(requirePermission('closing.view'));

closingRouter.get('/preview', async (req, res) => {
  const q = parse(z.object({ date: zBizDate.optional() }), req.query);
  res.json(await closingPreview(q.date || today()));
});

closingRouter.get('/history', async (req, res) => {
  const q = parse(
    z.object({
      limit: z.coerce.number().int().min(1).max(365).optional().default(60),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(await closingHistory(q));
});

closingRouter.post('/', requirePermission('closing.perform'), async (req, res) => {
  const body = parse(
    z.object({
      date: zBizDate.optional(),
      actual: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
      note: z.string().trim().max(500).optional().default(''),
    }),
    req.body
  );
  res.status(201).json(await closeDay(body, req.user, req.ip));
});

closingRouter.post('/reopen', requirePermission('closing.reopen'), async (req, res) => {
  const body = parse(
    z.object({ date: zBizDate, reason: z.string().trim().min(3).max(300) }),
    req.body
  );
  res.json(await reopenDay(body, req.user, req.ip));
});
