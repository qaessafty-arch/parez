/** API router — mounts all feature routes. */
import { Router } from 'express';
import { requireAuth } from '../middleware/index.js';
import setupRouter, { setupPublicInfo } from './setup.js';
import authRouter from './auth.js';
import usersRouter from './users.js';
import customersRouter from './customers.js';
import transactionsRouter from './transactions.js';
import receiptsRouter from './receipts.js';
import fastpayRouter from './fastpay.js';
import nasswalletRouter from './nasswallet.js';
import ronakiRouter from './ronaki.js';
import expensesRouter from './expenses.js';
import { cashRouter, closingRouter } from './cash.js';
import {
  dashboardRouter, reportsRouter, searchRouter, auditRouter, incomeRouter, backupsRouter,
} from './extras.js';
import { masterRouter, settingsRouter } from './meta.js';
import brandingRouter from './branding.js';
import devRouter from './dev.js';
import { config } from '../config.js';

const router = Router();

// Public
router.use('/setup', setupRouter);
router.use('/auth', authRouter);

// Everything below requires a session
router.use(requireAuth);

router.get('/meta', (req, res) => {
  const info = setupPublicInfo();
  res.json({
    ...info,
    // A stored filename is not a URL; give the client something it can load.
    shopLogo: info.shop?.logo ? `/api/branding/logo/${info.shop.logo}` : '',
    devMode: config.devAccount.enabled,
    user: req.user,
    now: new Date().toISOString(),
  });
});

router.use('/master', masterRouter);
router.use('/settings', settingsRouter);
router.use('/users', usersRouter);
router.use('/customers', customersRouter);
router.use('/transactions', transactionsRouter);
router.use('/receipts', receiptsRouter);
router.use('/fastpay', fastpayRouter);
router.use('/nasswallet', nasswalletRouter);
router.use('/ronaki', ronakiRouter);
router.use('/expenses', expensesRouter);
router.use('/cash', cashRouter);
router.use('/closing', closingRouter);
router.use('/dashboard', dashboardRouter);
router.use('/reports', reportsRouter);
router.use('/search', searchRouter);
router.use('/audit', auditRouter);
router.use('/income', incomeRouter);
router.use('/backups', backupsRouter);
router.use('/branding', brandingRouter);

// Dev diagnostics exist only when the server booted with the dev account
// enabled. In a production install this branch is never taken.
if (config.devAccount.enabled) router.use('/dev', devRouter);

export default router;
