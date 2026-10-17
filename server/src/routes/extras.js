/** Dashboard, reports, search, audit, income, backup routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import { dashboard } from '../services/dashboard.js';
import { runReport, toCsv, reportFileName, REPORT_TYPES } from '../services/reports.js';
import { globalSearch } from '../services/search.js';
import { listAudit, audit } from '../services/audit.js';
import { listBackups, createBackup, backupFilePath, restoreBackup } from '../services/backup.js';
import { rangeSummary } from '../services/transactions.js';
import { resolveRange } from '../lib/dates.js';
import { formatAmount } from '../lib/money.js';
import { requireAuth } from '../middleware/index.js';
import { all, transaction } from '../db/index.js';

// ---------------------------------------------------------------- Dashboard
export const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard.view'), async (req, res) => {
  const q = parse(
    z.object({
      range: z.string().default('today'),
      from: zBizDate.optional(),
      to: zBizDate.optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.query
  );
  res.json(await dashboard(q));
});

// ---------------------------------------------------------------- Reports
export const reportsRouter = Router();
reportsRouter.use(requirePermission('report.view'));

const reportQuery = z.object({
  from: zBizDate.optional(),
  to: zBizDate.optional(),
  currency: z.enum(['IQD', 'USD']).optional(),
  service_code: z.string().optional(),
  type_code: z.string().optional(),
  status: z.string().optional(),
  category_id: z.coerce.number().int().optional(),
  customer_id: z.coerce.number().int().optional(),
  project_id: z.coerce.number().int().optional(),
  q: z.string().optional(),
  format: z.enum(['json', 'csv']).optional(),
});

reportsRouter.get('/types', async (req, res) => res.json({ types: REPORT_TYPES }));

reportsRouter.get('/:type', async (req, res) => {
  const params = parse(reportQuery, { ...req.query, ...{ category_id: req.query.category_id } });
  const report = await runReport(req.params.type, params);
  if (req.query.format === 'csv') {
    const csv = toCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(req.params.type, report.range)}"`);
    return res.send(csv);
  }
  res.json(report);
});

// ---------------------------------------------------------------- Search
export const searchRouter = Router();
searchRouter.get('/', requireAuth, async (req, res) => {
  const q = parse(z.object({ q: z.string().optional().default(''), limit: z.coerce.number().int().min(1).max(20).optional().default(8) }), req.query);
  res.json(await globalSearch(q.q, { limit: q.limit }));
});

// ---------------------------------------------------------------- Audit
export const auditRouter = Router();
auditRouter.use(requirePermission('audit.view'));

auditRouter.get('/', async (req, res) => {
  const q = parse(
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      action: z.string().optional(),
      entity: z.string().optional(),
      search: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(await listAudit(q));
});

auditRouter.get('/actions', async (req, res) => {
  const rows = await all('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json({ actions: rows.map((r) => r.action) });
});

// Admin: delete audit log entry
auditRouter.delete('/:id', requirePermission('audit.manage'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Audit log not found' } });
  db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id);
  transaction((conn) => audit(conn, { user: req.user, action: 'AUDIT_DELETED', entity: 'audit_log', entityId: id, newValue: row, ip: req.ip }));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Income & Commission
export const incomeRouter = Router();
incomeRouter.use(requirePermission('report.view'));

incomeRouter.get('/summary', async (req, res) => {
  const q = parse(
    z.object({ range: z.string().default('today'), from: zBizDate.optional(), to: zBizDate.optional(), currency: z.enum(['IQD', 'USD']).optional() }),
    req.query
  );
  const r = q.from && q.to ? { from: q.from, to: q.to } : resolveRange(q.range);
  const commission = (await rangeSummary(r.from, r.to, { currency: q.currency })).map((s) => ({
    currency: s.currency, commission_minor: s.commission_minor, volume_minor: s.inflow_minor + s.outflow_minor, tx_count: s.tx_count,
  }));

  const curFilter = q.currency ? 'AND t.currency = ?' : '';
  const curArgs = q.currency ? [r.from, r.to, q.currency] : [r.from, r.to];

  const otherIncome = await all(
    `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS income_minor, COUNT(*) AS count
     FROM transactions t JOIN transaction_types tt ON tt.id = t.type_id
     WHERE tt.code IN ('income','commission') AND t.status='completed'
       AND t.biz_date >= ? AND t.biz_date <= ? ${curFilter}
     GROUP BY t.currency`,
    ...curArgs
  );

  const fees = await all(
    `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS fees_minor
     FROM expenses e JOIN transactions t ON t.id = e.txn_id
     JOIN expense_categories c ON c.id = e.category_id
     WHERE c.code = 'wallet_fees' AND t.status='completed'
       AND t.biz_date >= ? AND t.biz_date <= ? ${curFilter}
     GROUP BY t.currency`,
    ...curArgs
  );

  const byService = await all(
    `SELECT s.name AS service_name, t.currency, COALESCE(SUM(t.commission_minor),0) AS commission_minor, COUNT(*) AS count
     FROM transactions t JOIN services s ON s.id = t.service_id
     WHERE t.status='completed' AND t.commission_minor > 0 AND t.biz_date >= ? AND t.biz_date <= ?
       ${curFilter}
     GROUP BY s.name, t.currency`,
    ...curArgs
  );

  res.json({
    range: r,
    commission,
    other_income: otherIncome,
    fees,
    by_service: byService.map((b) => ({ ...b, commission_display: formatAmount(b.commission_minor) })),
    note: 'Transaction volume is NOT profit — profit = commission + other income.',
  });
});

// ---------------------------------------------------------------- Backups
export const backupsRouter = Router();
backupsRouter.use(requirePermission('backup.manage'));

backupsRouter.get('/', async (req, res) => res.json(await listBackups()));

backupsRouter.post('/', async (req, res) => {
  const body = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body || {});
  res.status(201).json(await createBackup(body.note, req.user, req.ip));
});

backupsRouter.get('/:id/download', async (req, res) => {
  const { row, text } = await backupFilePath(req.params.id);
  await audit({ user: req.user, action: 'BACKUP', entity: 'backup', entityId: row.file_name, reason: 'downloaded', ip: req.ip });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
  res.send(text);
});

backupsRouter.post('/:id/restore', async (req, res) => {
  const body = parse(z.object({ confirm: z.string().min(1) }), req.body);
  res.json(await restoreBackup(Number(req.params.id), body, req.user, req.ip));
});
