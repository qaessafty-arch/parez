/** Dashboard, reports, search, audit, income, backup routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate } from '../lib/validate.js';
import { dashboard } from '../services/dashboard.js';
import { runReport, toCsv, reportFileName, REPORT_TYPES } from '../services/reports.js';
import { globalSearch } from '../services/search.js';
import { listAudit } from '../services/audit.js';
import { listBackups, createBackup, backupFilePath, restoreBackup } from '../services/backup.js';
import { getDb } from '../db/index.js';
import { rangeSummary } from '../services/transactions.js';
import { resolveRange } from '../lib/dates.js';
import { formatAmount } from '../lib/money.js';
import { requireAuth } from '../middleware/index.js';
import { audit } from '../services/audit.js';
import { transaction } from '../db/index.js';

// ---------------------------------------------------------------- Dashboard
export const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard.view'), (req, res) => {
  const q = parse(
    z.object({
      range: z.string().default('today'),
      from: zBizDate.optional(),
      to: zBizDate.optional(),
      currency: z.enum(['IQD', 'USD']).optional(),
    }),
    req.query
  );
  res.json(dashboard(q));
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

reportsRouter.get('/types', (req, res) => res.json({ types: REPORT_TYPES }));

reportsRouter.get('/:type', (req, res) => {
  const params = parse(reportQuery, { ...req.query, ...{ category_id: req.query.category_id } });
  const report = runReport(req.params.type, params);
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
searchRouter.get('/', requireAuth, (req, res) => {
  const q = parse(z.object({ q: z.string().optional().default(''), limit: z.coerce.number().int().min(1).max(20).optional().default(8) }), req.query);
  res.json(globalSearch(q.q, { limit: q.limit }));
});

// ---------------------------------------------------------------- Audit
export const auditRouter = Router();
auditRouter.use(requirePermission('audit.view'));

auditRouter.get('/', (req, res) => {
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
  res.json(listAudit(q));
});

auditRouter.get('/actions', (req, res) => {
  const rows = getDb().prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all();
  res.json({ actions: rows.map((r) => r.action) });
});

// ---------------------------------------------------------------- Income & Commission
export const incomeRouter = Router();
incomeRouter.use(requirePermission('report.view'));

incomeRouter.get('/summary', (req, res) => {
  const q = parse(
    z.object({ range: z.string().default('today'), from: zBizDate.optional(), to: zBizDate.optional(), currency: z.enum(['IQD', 'USD']).optional() }),
    req.query
  );
  const r = q.from && q.to ? { from: q.from, to: q.to } : resolveRange(q.range);
  const db = getDb();

  const commission = rangeSummary(r.from, r.to, { currency: q.currency }).map((s) => ({
    currency: s.currency, commission_minor: s.commission_minor, volume_minor: s.inflow_minor + s.outflow_minor, tx_count: s.tx_count,
  }));

  const otherIncome = db
    .prepare(
      `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS income_minor, COUNT(*) AS count
       FROM transactions t JOIN transaction_types tt ON tt.id = t.type_id
       WHERE tt.code IN ('income','commission') AND t.status='completed'
         AND t.biz_date >= ? AND t.biz_date <= ? ${q.currency ? 'AND t.currency = ?' : ''}
       GROUP BY t.currency`
    )
    .all(...(q.currency ? [r.from, r.to, q.currency] : [r.from, r.to]));

  const fees = db
    .prepare(
      `SELECT t.currency, COALESCE(SUM(t.amount_minor),0) AS fees_minor
       FROM expenses e JOIN transactions t ON t.id = e.txn_id
       JOIN expense_categories c ON c.id = e.category_id
       WHERE c.code = 'wallet_fees' AND t.status='completed'
         AND t.biz_date >= ? AND t.biz_date <= ? ${q.currency ? 'AND t.currency = ?' : ''}
       GROUP BY t.currency`
    )
    .all(...(q.currency ? [r.from, r.to, q.currency] : [r.from, r.to]));

  const byService = db
    .prepare(
      `SELECT s.name AS service_name, t.currency, COALESCE(SUM(t.commission_minor),0) AS commission_minor, COUNT(*) AS count
       FROM transactions t JOIN services s ON s.id = t.service_id
       WHERE t.status='completed' AND t.commission_minor > 0 AND t.biz_date >= ? AND t.biz_date <= ?
         ${q.currency ? 'AND t.currency = ?' : ''}
       GROUP BY s.name, t.currency`
    )
    .all(...(q.currency ? [r.from, r.to, q.currency] : [r.from, r.to]));

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

backupsRouter.get('/', (req, res) => res.json(listBackups()));

backupsRouter.post('/', (req, res) => {
  const body = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body || {});
  res.status(201).json(createBackup(body.note, req.user, req.ip));
});

backupsRouter.get('/:id/download', (req, res) => {
  const { row, path } = backupFilePath(req.params.id);
  transaction((conn) => audit(conn, { user: req.user, action: 'BACKUP', entity: 'backup', entityId: row.file_name, reason: 'downloaded', ip: req.ip }));
  res.download(path, row.file_name);
});

backupsRouter.post('/:id/restore', (req, res) => {
  const body = parse(z.object({ confirm: z.string().min(1) }), req.body);
  res.json(restoreBackup(Number(req.params.id), body, req.user, req.ip));
});
