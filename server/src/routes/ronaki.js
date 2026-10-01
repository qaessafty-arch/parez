/** Ronaki Project routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z, zBizDate, zReference, zPhone } from '../lib/validate.js';
import {
  listProjects, createProject, listContracts, getContract, createContract,
  updateContract, addPayment, ronakiReport,
} from '../services/ronaki.js';
import { createReceiptForTransaction } from '../services/receipts.js';

const router = Router();

router.use(requirePermission('ronaki.view'));

router.get('/projects', (req, res) => res.json({ projects: listProjects() }));

router.post('/projects', requirePermission('ronaki.create'), (req, res) => {
  const body = parse(
    z.object({ code: z.string().trim().min(2).max(40), name: z.string().trim().min(2).max(80), location: z.string().max(120).optional() }),
    req.body
  );
  res.status(201).json(createProject(body, req.user, req.ip));
});

router.get('/contracts', (req, res) => {
  const q = parse(
    z.object({
      q: z.string().optional().default(''),
      project_id: z.coerce.number().int().optional(),
      status: z.enum(['unpaid', 'partially_paid', 'paid', 'overdue']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    req.query
  );
  res.json(listContracts(q));
});

const contractBody = z.object({
  contract_number: z.string().trim().min(2).max(40),
  project_id: z.coerce.number().int(),
  customer_id: z.coerce.number().int(),
  house_unit: z.string().trim().max(40).optional().default(''),
  customer_ref: z.string().trim().max(40).optional().default(''),
  total_required: z.union([z.string(), z.number()]),
  currency: z.enum(['IQD', 'USD']).default('IQD'),
  start_date: zBizDate.optional(),
  due_date: zBizDate.nullable().optional(),
  notes: z.string().trim().max(500).optional().default(''),
});

router.post('/contracts', requirePermission('ronaki.create'), (req, res) => {
  const body = parse(contractBody, req.body);
  res.status(201).json(createContract(body, req.user, req.ip));
});

router.get('/contracts/:id', (req, res) => {
  res.json(getContract(req.params.id));
});

router.patch('/contracts/:id', requirePermission('ronaki.edit'), (req, res) => {
  const body = parse(
    contractBody.partial().extend({ total_required: z.union([z.string(), z.number()]).optional() }),
    req.body
  );
  res.json(updateContract(Number(req.params.id), body, req.user, req.ip));
});

router.post('/contracts/:id/payments', requirePermission('ronaki.payment'), (req, res) => {
  const body = parse(
    z.object({
      amount: z.union([z.string(), z.number()]),
      currency: z.enum(['IQD', 'USD']).optional(),
      account_id: z.coerce.number().int().optional(),
      payment_method: z.string().max(30).optional(),
      reference_no: zReference.optional(),
      biz_date: zBizDate.optional(),
      notes: z.string().trim().max(300).optional(),
      receipt: z.boolean().optional(),
    }),
    req.body
  );
  const { receipt, ...input } = body;
  const result = addPayment({ ...input, contract_id: Number(req.params.id) }, req.user, req.ip);
  const receiptRow = receipt === false ? null : createReceiptForTransaction(result.transaction_id, req.user, req.ip, { silentDuplicate: true });
  res.status(201).json({ ...result, receipt: receiptRow });
});

router.get('/payments', (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(),
      q: z.string().optional().default(''),
      project_id: z.coerce.number().int().optional(),
    }),
    req.query
  );
  res.json(ronakiReport(q));
});

router.get('/report', requirePermission('report.view'), (req, res) => {
  const q = parse(
    z.object({
      from: zBizDate.optional(), to: zBizDate.optional(),
      q: z.string().optional().default(''),
      project_id: z.coerce.number().int().optional(),
      status: z.enum(['unpaid', 'partially_paid', 'paid', 'overdue']).optional(),
    }),
    req.query
  );
  res.json(ronakiReport(q));
});

export default router;
