/**
 * Dealer Inventory — stock management for FIB, CardHouse, FastPay, NassWallet.
 * Tracks wholesale purchases and retail sales with audit trail.
 */
import { all, one, run, transaction } from '../db/index.js';
import { validationError, notFound } from '../lib/errors.js';
import { today, nowIso } from '../lib/dates.js';
import { audit } from './audit.js';

const DEALER_ACCOUNT_CODES = ['FASTPAY', 'NASSWALLET', 'FIB', 'CARDHOUSE'];

/** Get or create dealer inventory record for an account. */
export async function getInventory(accountId, currency) {
  let inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', accountId, currency);
  if (!inv && currency) {
    // Auto-create if missing (idempotent)
    const account = await one('SELECT * FROM accounts WHERE id = ?', accountId);
    if (account && account.currency === currency) {
      await transaction(async () => {
        await run(`INSERT INTO dealer_inventory (account_id, currency, wholesale_qty, wholesale_cost_minor, retail_qty, retail_revenue_minor, current_qty, profit_minor)
           VALUES (?, ?, 0, 0, 0, 0, 0, 0)
           ON CONFLICT(account_id, currency) DO NOTHING`, accountId, currency);
      });
      inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', accountId, currency);
    }
  }
  return inv;
}

/** List all dealer inventory with account info. */
export async function listInventory() {
  return await all(`
    SELECT di.*, a.code AS account_code, a.name AS account_name, a.kind AS account_kind
    FROM dealer_inventory di
    JOIN accounts a ON a.id = di.account_id
    ORDER BY a.sort_order, di.currency
  `);
}

/** Get inventory for a specific account code. */
export async function getInventoryByAccountCode(accountCode, currency) {
  const account = await one('SELECT * FROM accounts WHERE code = ?', accountCode);
  if (!account) return null;
  return getInventory(account.id, currency);
}

/** Record a wholesale purchase (buy stock from supplier). */
export async function recordPurchase({ accountCode, currency, qty, unitCostMinor, referenceTxnId, notes, user, ip }) {
  if (!DEALER_ACCOUNT_CODES.includes(accountCode)) {
    throw validationError(`Invalid dealer account: ${accountCode}`);
  }
  if (qty <= 0) throw validationError('Purchase quantity must be positive');
  if (unitCostMinor < 0) throw validationError('Unit cost cannot be negative');

  return await transaction(async () => {
    const account = await one('SELECT * FROM accounts WHERE code = ?', accountCode);
    if (!account) throw validationError(`Account ${accountCode} not found`);

    let inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', account.id, currency);
    if (!inv) {
      await run(`INSERT INTO dealer_inventory (account_id, currency, wholesale_qty, wholesale_cost_minor, retail_qty, retail_revenue_minor, current_qty, profit_minor)
         VALUES (?, ?, 0, 0, 0, 0, 0, 0)
         ON CONFLICT(account_id, currency) DO NOTHING`, account.id, currency);
      inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', account.id, currency);
    }

    const totalCostMinor = qty * unitCostMinor;

    await run(`UPDATE dealer_inventory
       SET wholesale_qty = wholesale_qty + ?,
           wholesale_cost_minor = wholesale_cost_minor + ?,
           current_qty = current_qty + ?,
           updated_at = ?
       WHERE id = ?`, qty, totalCostMinor, qty, nowIso(), inv.id);

    const newInv = await one('SELECT * FROM dealer_inventory WHERE id = ?', inv.id);

    // Movement audit
    await run(`INSERT INTO dealer_inventory_movements (inventory_id, movement_type, qty_change, wholesale_cost_minor, retail_price_minor, reference_txn_id, notes, created_by, created_at)
       VALUES (?, 'purchase', ?, ?, 0, ?, ?, ?, ?)`, inv.id, qty, totalCostMinor, referenceTxnId || null, notes || null, user.id, nowIso());

    await audit({
      user,
      action: 'DEALER_PURCHASE',
      entity: 'dealer_inventory',
      entityId: inv.id,
      newValue: { account: accountCode, qty, unit_cost: unitCostMinor, total_cost: totalCostMinor },
      reason: notes || 'Wholesale purchase',
      ip,
    });

    return { inventory: newInv, movement: { type: 'purchase', qty, unit_cost: unitCostMinor, total_cost: totalCostMinor } };
  });
}

/** Record a retail sale (sell stock to customer). */
export async function recordSale({ accountCode, currency, qty, unitPriceMinor, referenceTxnId, notes, user, ip }) {
  if (!DEALER_ACCOUNT_CODES.includes(accountCode)) {
    throw validationError(`Invalid dealer account: ${accountCode}`);
  }
  if (qty <= 0) throw validationError('Sale quantity must be positive');
  if (unitPriceMinor < 0) throw validationError('Unit price cannot be negative');

  return await transaction(async () => {
    const account = await one('SELECT * FROM accounts WHERE code = ?', accountCode);
    if (!account) throw validationError(`Account ${accountCode} not found`);

    const inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', account.id, currency);
    if (!inv) throw notFound('Dealer inventory');
    if (inv.current_qty < qty) throw validationError(`Insufficient stock: have ${inv.current_qty}, need ${qty}`);

    const totalRevenueMinor = qty * unitPriceMinor;
    const unitCostMinor = inv.wholesale_qty > 0 ? Math.floor(inv.wholesale_cost_minor / inv.wholesale_qty) : 0;
    const totalCostMinor = qty * unitCostMinor;
    const profitMinor = totalRevenueMinor - totalCostMinor;

    await run(`UPDATE dealer_inventory
       SET retail_qty = retail_qty + ?,
           retail_revenue_minor = retail_revenue_minor + ?,
           current_qty = current_qty - ?,
           profit_minor = profit_minor + ?,
           updated_at = ?
       WHERE id = ?`, qty, totalRevenueMinor, qty, profitMinor, nowIso(), inv.id);

    const newInv = await one('SELECT * FROM dealer_inventory WHERE id = ?', inv.id);

    await run(`INSERT INTO dealer_inventory_movements (inventory_id, movement_type, qty_change, wholesale_cost_minor, retail_price_minor, reference_txn_id, notes, created_by, created_at)
       VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, ?)`, inv.id, -qty, totalCostMinor, totalRevenueMinor, referenceTxnId || null, notes || null, user.id, nowIso());

    await audit({
      user,
      action: 'DEALER_SALE',
      entity: 'dealer_inventory',
      entityId: inv.id,
      newValue: { account: accountCode, qty, unit_price: unitPriceMinor, total_revenue: totalRevenueMinor, profit: profitMinor },
      reason: notes || 'Retail sale',
      ip,
    });

    return { inventory: newInv, movement: { type: 'sale', qty, unit_price: unitPriceMinor, total_revenue: totalRevenueMinor, profit: profitMinor } };
  });
}

/** Manual adjustment (positive or negative). */
export async function recordAdjustment({ accountCode, currency, qtyChange, unitCostMinor, unitPriceMinor, notes, user, ip }) {
  if (!DEALER_ACCOUNT_CODES.includes(accountCode)) {
    throw validationError(`Invalid dealer account: ${accountCode}`);
  }
  if (qtyChange === 0) throw validationError('Adjustment quantity cannot be zero');

  return await transaction(async () => {
    const account = await one('SELECT * FROM accounts WHERE code = ?', accountCode);
    if (!account) throw validationError(`Account ${accountCode} not found`);

    const inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', account.id, currency);
    if (!inv) throw notFound('Dealer inventory');
    if (inv.current_qty + qtyChange < 0) throw validationError(`Adjustment would make stock negative: ${inv.current_qty} + ${qtyChange}`);

    const isPositive = qtyChange > 0;
    const movementType = isPositive ? 'adjustment' : 'adjustment';
    const costDelta = isPositive ? (unitCostMinor || 0) * qtyChange : 0;
    const revenueDelta = !isPositive ? (unitPriceMinor || 0) * Math.abs(qtyChange) : 0;
    const profitDelta = revenueDelta - costDelta;

    await run(`UPDATE dealer_inventory
       SET current_qty = current_qty + ?,
           profit_minor = profit_minor + ?,
           updated_at = ?
       WHERE id = ?`, qtyChange, profitDelta, nowIso(), inv.id);

    const newInv = await one('SELECT * FROM dealer_inventory WHERE id = ?', inv.id);

    await run(`INSERT INTO dealer_inventory_movements (inventory_id, movement_type, qty_change, wholesale_cost_minor, retail_price_minor, reference_txn_id, notes, created_by, created_at)
       VALUES (?, 'adjustment', ?, ?, ?, null, ?, ?, ?)`, inv.id, qtyChange, costDelta, revenueDelta, notes || 'Manual adjustment', user.id, nowIso());

    await audit({
      user,
      action: 'DEALER_ADJUSTMENT',
      entity: 'dealer_inventory',
      entityId: inv.id,
      newValue: { account: accountCode, qty_change: qtyChange },
      reason: notes || 'Manual adjustment',
      ip,
    });

    return { inventory: newInv };
  });
}

/** Get movement history for an inventory. */
export async function getMovements(inventoryId, { limit = 100, offset = 0 } = {}) {
  const total = (await one('SELECT COUNT(*) AS c FROM dealer_inventory_movements WHERE inventory_id = ?', inventoryId)).c;
  const rows = await all(`SELECT dim.*, u.full_name AS created_by_name FROM dealer_inventory_movements dim LEFT JOIN users u ON u.id = dim.created_by WHERE dim.inventory_id = ? ORDER BY dim.created_at DESC LIMIT ? OFFSET ?`, inventoryId, Math.min(limit, 500), offset);
  return { total, rows };
}

/** Get dealer inventory summary for closing. */
export async function getDealerInventorySummary(date = today()) {
  const result = [];
  for (const code of DEALER_ACCOUNT_CODES) {
    const acct = await one('SELECT * FROM accounts WHERE code = ?', code);
    if (!acct) continue;
    const inv = await one('SELECT * FROM dealer_inventory WHERE account_id = ? AND currency = ?', acct.id, acct.currency);
    if (!inv) continue;
    result.push({
      code: acct.code,
      name: acct.name,
      currency: acct.currency,
      wholesale_qty: inv.wholesale_qty,
      wholesale_cost_minor: inv.wholesale_cost_minor,
      retail_qty: inv.retail_qty,
      retail_revenue_minor: inv.retail_revenue_minor,
      current_qty: inv.current_qty,
      profit_minor: inv.profit_minor,
    });
  }
  return result;
}