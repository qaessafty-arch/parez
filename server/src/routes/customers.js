/** Customer routes. */
import { Router } from 'express';
import { requirePermission } from '../middleware/index.js';
import { parse, z } from '../lib/validate.js';
import {
  searchCustomers, getCustomer, createCustomer, updateCustomer, customerHistory,
} from '../services/customers.js';

const router = Router();

const customerBody = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).optional().default(''),
  address: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
});

router.get('/', requirePermission('customer.view'), (req, res) => {
  const q = parse(
    z.object({ q: z.string().optional().default(''), limit: z.coerce.number().int().min(1).max(100).optional().default(25), offset: z.coerce.number().int().min(0).optional().default(0) }),
    req.query
  );
  res.json(searchCustomers(q));
});

router.post('/', requirePermission('customer.create'), (req, res) => {
  const body = parse(customerBody, req.body);
  res.status(201).json(createCustomer(body, req.user, req.ip));
});

router.get('/:id', requirePermission('customer.view'), (req, res) => {
  res.json(getCustomer(Number(req.params.id)));
});

router.get('/:id/history', requirePermission('customer.view'), (req, res) => {
  res.json(customerHistory(Number(req.params.id)));
});

router.patch('/:id', requirePermission('customer.edit'), (req, res) => {
  const body = parse(customerBody.partial(), req.body);
  res.json(updateCustomer(Number(req.params.id), body, req.user, req.ip));
});

export default router;
