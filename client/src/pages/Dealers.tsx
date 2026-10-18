import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile, errText } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls, amountDisplay, todayISO } from '../lib/format';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, MoneyInput, PageHeader,
  Spinner, Table, Td, Textarea, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

type Inventory = {
  id: number;
  account_id: number;
  account_code: string;
  account_name: string;
  currency: string;
  wholesale_qty: number;
  wholesale_cost_minor: number;
  retail_qty: number;
  retail_revenue_minor: number;
  current_qty: number;
  profit_minor: number;
};

type Movement = {
  id: number;
  movement_type: 'purchase' | 'sale' | 'adjustment';
  qty_change: number;
  wholesale_cost_minor: number;
  retail_price_minor: number;
  reference_txn_id: number | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
};

export default function Dealers() {
  const { t } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const { data, loading, error, reload } = useLoad(() => api<any>('/api/dealers'), []);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ inventory: Inventory; movements: { total: number; rows: Movement[] } } | null>(null);
  const [movementsPage, setMovementsPage] = useState(0);

  useEffect(() => {
    const id = params.get('id');
    if (id && Number.isFinite(Number(id))) {
      setDetailId(Number(id));
      loadDetail(Number(id));
    } else {
      setDetailId(null);
      setDetail(null);
    }
  }, [params]);

  const loadDetail = async (id: number) => {
    try {
      const [inv, mov] = await Promise.all([
        api<any>(`/api/dealers/${id}`),
        api<any>(`/api/dealers/${id}/movements?limit=50`),
      ]);
      setDetail({ inventory: inv.inventory, movements: mov });
    } catch (e) {
      toast('err', errText(e));
    }
  };

  const handlePageChange = (dir: number) => {
    setMovementsPage((p) => Math.max(0, p + dir));
    if (detailId) {
      api<any>(`/api/dealers/${detailId}/movements?limit=50&offset=${(movementsPage + dir) * 50}`)
        .then((mov) => setDetail((d) => d ? { ...d, movements: mov } : null))
        .catch((e) => toast('err', errText(e)));
    }
  };

  return (
    <div>
      <PageHeader title={t('dealers_title') || 'Dealer Inventory'} subtitle={t('dealers_subtitle') || 'Wholesale stock & retail sales for digital wallets'}>
        <Button variant="outline" size="sm" onClick={() => downloadFile('/api/reports/dealers?format=csv')}>
          ⬇ {t('export_csv')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadFile('/api/reports/dealer_movements?format=csv')}>
          ⬇ Movements
        </Button>
      </PageHeader>

      {error && <Alert tone="err" title={error} />}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.length === 0 ? <EmptyState text={t('no_dealers') || 'No dealer accounts configured'} /> : (
            <Table head={[t('account'), t('currency'), t('wholesale_qty'), t('wholesale_cost'), t('retail_qty'), t('retail_revenue'), t('current_qty'), t('profit'), t('actions')]}>
              {data.map((inv: Inventory) => (
                <tr key={inv.id} className="hover:bg-surface">
                  <Td className="font-semibold text-xs">
                    {inv.account_name} <span className="text-text-muted ml-1">({inv.account_code})</span>
                  </Td>
                  <Td className="num text-xs">{inv.currency}</Td>
                  <Td className="num text-xs">{inv.wholesale_qty.toLocaleString()}</Td>
                  <Td className="num text-xs"><Money minor={inv.wholesale_cost_minor} currency={inv.currency} /></Td>
                  <Td className="num text-xs">{inv.retail_qty.toLocaleString()}</Td>
                  <Td className="num text-xs text-in-600"><Money minor={inv.retail_revenue_minor} currency={inv.currency} /></Td>
                  <Td className="num text-xs font-bold">{inv.current_qty.toLocaleString()}</Td>
                  <Td className="num text-xs">
                    <Money minor={inv.profit_minor} currency={inv.currency} className={inv.profit_minor >= 0 ? 'text-in-600' : 'text-out-600'} bold />
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => {
                        const p = new URLSearchParams(params);
                        p.set('id', String(inv.id));
                        setParams(p, { replace: true });
                      }}>
                        {t('view_detail') || 'Details'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openPurchase(inv)}>
                        ＋ {t('purchase') || 'Buy Stock'}
                      </Button>
                      <Button variant="success" size="sm" disabled={inv.current_qty <= 0} onClick={() => openSale(inv)}>
                        ＋ {t('sale') || 'Sell'}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {detail && (
        <Modal open onClose={() => { const p = new URLSearchParams(params); p.delete('id'); setParams(p, { replace: true }); setDetail(null); setMovementsPage(0); }} title={`${t('view_detail') || 'Details'} — {detail.inventory.account_name} ({detail.inventory.account_code})`} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label={t('wholesale_qty')} value={detail.inventory.wholesale_qty.toLocaleString()} />
              <Stat label={t('wholesale_cost') || 'Wholesale Cost'} value={<Money minor={detail.inventory.wholesale_cost_minor} currency={detail.inventory.currency} />} />
              <Stat label={t('retail_qty')} value={detail.inventory.retail_qty.toLocaleString()} />
              <Stat label={t('retail_revenue') || 'Retail Revenue'} value={<Money minor={detail.inventory.retail_revenue_minor} currency={detail.inventory.currency} className="text-in-600" />} />
              <Stat label={t('current_qty') || 'On Hand'} value={<span className="font-bold">{detail.inventory.current_qty.toLocaleString()}</span>} />
              <Stat label={t('profit') || 'Profit'} value={<Money minor={detail.inventory.profit_minor} currency={detail.inventory.currency} className={detail.inventory.profit_minor >= 0 ? 'text-in-600' : 'text-out-600'} bold />} />
            </div>

            <div className="border-t border-border-color pt-4">
              <h3 className="mb-2 text-xs font-bold text-text-muted flex items-center justify-between">
                {t('movements') || 'Movements'}
                <span className="text-text-muted">({detail.movements.total})</span>
              </h3>
              {detail.movements.rows.length === 0 ? (
                <EmptyState text={t('no_movements') || 'No movements recorded'} />
              ) : (
                <Table head={[t('type'), t('qty_change'), t('wholesale_cost'), t('retail_price'), t('reference_txn'), t('notes'), t('created_by'), t('date')]}>
                  {detail.movements.rows.map((m: Movement) => (
                    <tr key={m.id} className="hover:bg-surface">
                      <Td>
                        <Badge kind={m.movement_type === 'purchase' ? 'ok' : m.movement_type === 'sale' ? 'blue' : 'warn'}>
                          {t(m.movement_type === 'purchase' ? 'purchase' : m.movement_type === 'sale' ? 'sale' : 'adjustment')}
                        </Badge>
                      </Td>
                      <Td className="num text-xs">{m.qty_change > 0 ? '+' : ''}{m.qty_change.toLocaleString()}</Td>
                      <Td className="num text-xs">
                        {m.wholesale_cost_minor ? <Money minor={m.wholesale_cost_minor} currency={detail.inventory.currency} /> : '—'}
                      </Td>
                      <Td className="num text-xs">
                        {m.retail_price_minor ? <Money minor={m.retail_price_minor} currency={detail.inventory.currency} /> : '—'}
                      </Td>
                      <Td className="num text-xs">{m.reference_txn_id ? `TX-${m.reference_txn_id}` : '—'}</Td>
                      <Td className="text-xs max-w-40 truncate">{m.notes || '—'}</Td>
                      <Td className="text-xs">{m.created_by_name || '—'}</Td>
                      <Td className="num text-xs">{String(m.created_at).slice(0, 16).replace('T', ' ')}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {detail.movements.total > 50 && (
                <div className="flex justify-center gap-2 mt-2">
                  <Button variant="outline" size="sm" disabled={movementsPage === 0} onClick={() => handlePageChange(-1)}>←</Button>
                  <span className="flex items-center text-xs text-text-muted">{movementsPage + 1}</span>
                  <Button variant="outline" size="sm" disabled={detail.movements.rows.length < 50} onClick={() => handlePageChange(1)}>→</Button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {purchaseOpen && <PurchaseModal inventory={purchaseInv!} onClose={closePurchase} onSaved={() => { closePurchase(); reload(); }} />}
      {saleOpen && <SaleModal inventory={saleInv!} onClose={closeSale} onSaved={() => { closeSale(); reload(); }} />}
      {adjustOpen && <AdjustModal inventory={adjustInv!} onClose={closeAdjust} onSaved={() => { closeAdjust(); reload(); }} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border-color/10 bg-white p-3">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}

function PurchaseModal({ inventory, onClose, onSaved }: { inventory: Inventory; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ qty: '', unit_cost: '', notes: '' });
  const setInput = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setTextarea = (k: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (!f.qty || Number(f.qty) <= 0) return setError(t('invalid_amount') || 'Invalid quantity');
    if (!f.unit_cost) return setError('Unit cost required');
    setBusy(true);
    try {
      await api('/api/dealers/purchase', {
        method: 'POST',
        body: {
          account_code: inventory.account_code,
          currency: inventory.currency,
          qty: Number(f.qty),
          unit_cost_minor: f.unit_cost.replace(/,/g, ''),
          notes: f.notes,
        },
      });
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${t('purchase') || 'Wholesale Purchase'} — {inventory.account_name}`}>
      <div className="space-y-4">
        <Field label={t('qty') || 'Quantity'} required><Input type="number" min="1" value={f.qty} onChange={setInput('qty')} autoFocus /></Field>
        <Field label={t('unit_cost') || 'Unit Cost'} required><MoneyInput value={f.unit_cost} onChange={setInput('unit_cost')} placeholder={t('auto_commission') || '0'} /></Field>
        <Field label={t('notes') || 'Notes'}><Textarea rows={2} value={f.notes} onChange={setTextarea('notes')} /></Field>
        {error && <Alert tone="err" title={error} />}
        <div className="flex justify-end gap-2 border-t border-border-color pt-4">
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function SaleModal({ inventory, onClose, onSaved }: { inventory: Inventory; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ qty: '', unit_price: '', notes: '' });
  const setInput = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setTextarea = (k: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (!f.qty || Number(f.qty) <= 0) return setError(t('invalid_amount') || 'Invalid quantity');
    if (Number(f.qty) > inventory.current_qty) return setError(`${t('insufficient_stock') || 'Insufficient stock'} (${inventory.current_qty})`);
    if (!f.unit_price) return setError('Unit price required');
    setBusy(true);
    try {
      await api('/api/dealers/sale', {
        method: 'POST',
        body: {
          account_code: inventory.account_code,
          currency: inventory.currency,
          qty: Number(f.qty),
          unit_price_minor: f.unit_price.replace(/,/g, ''),
          notes: f.notes,
        },
      });
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${t('sale') || 'Retail Sale'} — {inventory.account_name}`}>
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex justify-between"><span>{t('available_stock') || 'Available Stock'}</span><b>{inventory.current_qty.toLocaleString()}</b></div>
          <div className="flex justify-between"><span>{t('avg_cost') || 'Avg Cost'}</span><Money minor={inventory.wholesale_qty > 0 ? Math.floor(inventory.wholesale_cost_minor / inventory.wholesale_qty) : 0} currency={inventory.currency} /></div>
        </div>
        <Field label={t('qty') || 'Quantity'} required><Input type="number" min="1" max={inventory.current_qty} value={f.qty} onChange={setInput('qty')} autoFocus /></Field>
        <Field label={t('unit_price') || 'Unit Price'} required><MoneyInput value={f.unit_price} onChange={setInput('unit_price')} placeholder={t('auto_commission') || '0'} /></Field>
        <Field label={t('notes') || 'Notes'}><Textarea rows={2} value={f.notes} onChange={setTextarea('notes')} /></Field>
        {error && <Alert tone="err" title={error} />}
        <div className="flex justify-end gap-2 border-t border-border-color pt-4">
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="success" onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AdjustModal({ inventory, onClose, onSaved }: { inventory: Inventory; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ qty_change: '', unit_cost: '', unit_price: '', notes: '' });
  const setInput = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setTextarea = (k: string) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (!f.qty_change || Number(f.qty_change) === 0) return setError('Qty change cannot be zero');
    setBusy(true);
    try {
      await api('/api/dealers/adjust', {
        method: 'POST',
        body: {
          account_code: inventory.account_code,
          currency: inventory.currency,
          qty_change: Number(f.qty_change),
          unit_cost_minor: f.unit_cost ? f.unit_cost.replace(/,/g, '') : undefined,
          unit_price_minor: f.unit_price ? f.unit_price.replace(/,/g, '') : undefined,
          notes: f.notes,
        },
      });
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${t('adjustment') || 'Adjustment'} — {inventory.account_name}`}>
      <div className="space-y-4">
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <div className="flex justify-between"><span>{t('current_stock') || 'Current Stock'}</span><b>{inventory.current_qty.toLocaleString()}</b></div>
        </div>
        <Field label={t('qty_change') || 'Qty Change'} required><Input type="number" value={f.qty_change} onChange={setInput('qty_change')} autoFocus placeholder="+/-" /></Field>
        <Field label={t('unit_cost') || 'Unit Cost'}><MoneyInput value={f.unit_cost} onChange={setInput('unit_cost')} placeholder={t('optional')} /></Field>
        <Field label={t('unit_price') || 'Unit Price'}><MoneyInput value={f.unit_price} onChange={setInput('unit_price')} placeholder={t('optional')} /></Field>
        <Field label={t('notes') || 'Notes'}><Textarea rows={2} value={f.notes} onChange={setTextarea('notes')} /></Field>
        {error && <Alert tone="err" title={error} />}
        <div className="flex justify-end gap-2 border-t border-border-color pt-4">
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

let purchaseOpen = false;
let purchaseInv: Inventory | null = null;
let saleOpen = false;
let saleInv: Inventory | null = null;
let adjustOpen = false;
let adjustInv: Inventory | null = null;

function openPurchase(inv: Inventory) { purchaseInv = inv; purchaseOpen = true; }
function closePurchase() { purchaseInv = null; purchaseOpen = false; }
function openSale(inv: Inventory) { saleInv = inv; saleOpen = true; }
function closeSale() { saleInv = null; saleOpen = false; }
