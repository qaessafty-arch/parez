/** User management routes (admin). */
import { Router } from 'express';
import { listUsers, createUser, updateUser } from '../services/auth.js';
import { requirePermission } from '../middleware/index.js';
import { parse, z } from '../lib/validate.js';

const router = Router();
router.use(requirePermission('user.manage'));

router.get('/', async (req, res) => {
  res.json(await listUsers());
});

router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      username: z.string().trim().min(3).max(32),
      full_name: z.string().trim().min(2).max(80),
      password: z.string().min(6).max(200),
      role_code: z.string().min(1),
    }),
    req.body
  );
  res.status(201).json(await createUser(body, req.user, req.ip));
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = parse(
    z.object({
      full_name: z.string().trim().min(2).max(80).optional(),
      role_code: z.string().min(1).optional(),
      is_active: z.boolean().optional(),
      password: z.string().min(6).max(200).optional(),
    }),
    req.body
  );
  res.json(await updateUser(id, body, req.user, req.ip));
});

export default router;
