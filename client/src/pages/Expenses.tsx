import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText, downloadFile } from '../lib/api';
import { useDraft } from '../lib/draft';
import { useI18n } from '../lib/i18n';
import { amountDisplay, parseAmount, todayISO } from '../lib/format';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, MoneyInput, PageHeader,
  Select, Spinner, Table, Td, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

export default function Expenses() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ from: '', to: '', category_id: '', q: params.get('q') ?? '' });
  const [newOpen, setNewOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  // The dashboard quick action links here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1' && can('expense.create')) {
      setNewOpen(true);
      setParams((prev) => { const p = new URLSearchParams(prev); p.delete('new'); return p; }, { replace: true });
    }
  }, [params, can, setParams]);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
  qs.set('limit', '200');

  const { data, loading, error, reload } = useLoad(() => api<any>(`/api/expenses?${qs}`), [qs.toString()]);
  const cats = useLoad(() => api<any>(`/api/expenses/categories?all=1`), []);

  const setF = (k: keyof typeof filters) => (e: React.ChangeEvent<any>) => setFilters((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <PageHeader title={t('nav_expenses')}>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/expense?format=csv&${qs}`)}>⬇ {t('export_csv')}</Button>
        <Button variant="outline" size="sm" onClick={() => setCatOpen(true)}>＋ {t('add_category')}</Button>
        {can('expense.create') && <Button onClick={() => setNewOpen(true)}>＋ {t('new_expense')}</Button>}
      </PageHeader>

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Input type="date" value={filters.from} onChange={setF('from')} aria-label={t('from')} />
          <Input type="date" value={filters.to} onChange={setF('to')} aria-label={t('to')} />
          <Select value={filters.category_id} onChange={setF('category_id')}>
            <option value="">{t('category')}: {t('all')}</option>
            {cats.data?.categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Input placeholder={t('search') + '…'} value={filters.q} onChange={setF('q')} />
        </div>
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          <div className="flex flex-wrap gap-4 border-b border-border-color/[.08] px-4 py-2.5 text-xs">
            {data.totals.map((x: any) => (
              <span key={x.currency} className="text-text-secondary">
                <b className="text-text-primary">{x.currency}</b>: {x.count} × ·
                {t('total')}: <b className="text-out-600 num">{amountDisplay(x.total_minor)} {x.currency}</b>
              </span>
            ))}
          </div>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('expense_number'), t('date'), t('category'), t('description'), t('supplier'), t('amount'), t('created_by')]}>
              {data.rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-surface">
                  <Td className="num text-xs font-semibold">{r.expense_number}</Td>
                  <Td className="num text-xs">{r.biz_date}</Td>
                  <Td><Badge kind="gray">{r.category_name}</Badge></Td>
                  <Td className="text-xs">{r.description}</Td>
                  <Td className="text-xs">{r.supplier || '—'}</Td>
                  <Td className="font-bold text-out-600"><Money minor={r.amount_minor} currency={r.currency} /></Td>
                  <Td className="text-xs text-text-secondary">{r.created_by_name}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {newOpen && (
        <ExpenseModal
          categories={cats.data?.categories ?? []}
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); reload(); toast('ok', t('created')); }}
        />
      )}
      {catOpen && (
        <CategoryModal
          onClose={() => setCatOpen(false)}
          onSaved={() => { setCatOpen(false); cats.reload(); toast('ok', t('created')); }}
        />
      )}
    </div>
  );
}

function ExpenseModal({ categories, onClose, onSaved }: { categories: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { master, meta } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = {
    category_id: String(categories[0]?.id ?? ''), description: '', amount: '', currency: meta.defaultCurrency,
    payment_method: 'cash', supplier: '', receipt_no: '', notes: '', biz_date: todayISO(),
  };
  const draft = useDraft('expense', blank);
  const [f, setF] = useState(() => draft.restored ?? blank);
  const update = (patch: Partial<typeof blank>) => setF((x) => {
    const next = { ...x, ...patch };
    draft.set(next);
    return next;
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<any>) => update({ [k]: e.target.value } as any);

  const submit = async () => {
    setError('');
    if (f.description.trim().length < 2) return setError(`${t('description')} — ${t('required')}`);
    if (parseAmount(f.amount) === null) return setError(`${t('amount')} — ${t('required')}`);
    setBusy(true);
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: {
          category_id: Number(f.category_id), description: f.description, amount: f.amount.replace(/,/g, ''),
          currency: f.currency, payment_method: f.payment_method, supplier: f.supplier,
          receipt_no: f.receipt_no, notes: f.notes, biz_date: f.biz_date,
        },
      });
      draft.clear();
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('new_expense')}>
      {draft.restored && (
        <div className="mb-4">
          <Alert tone="info" title={t('draft_recovered')}>
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              onClick={() => { draft.discard(); setF(blank); }}
            >
              {t('discard_draft')}
            </button>
          </Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('category')} required>
          <Select value={f.category_id} onChange={set('category_id')}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('date')}><Input type="date" value={f.biz_date} onChange={set('biz_date')} /></Field>
        <Field label={t('description')} required className="sm:col-span-2"><Input value={f.description} onChange={set('description')} /></Field>
        <Field label={t('amount')} required><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
        <Field label={t('currency')}>
          <Select value={f.currency} onChange={set('currency')}>
            {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
        </Field>
        <Field label={t('supplier')}><Input value={f.supplier} onChange={set('supplier')} /></Field>
        <Field label={t('receipt_no')}><Input value={f.receipt_no} onChange={set('receipt_no')} dir="ltr" /></Field>
        <Field label={t('payment_method')}>
          <Select value={f.payment_method} onChange={set('payment_method')}>
            {master.payment_methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('notes')}><Input value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color/[.08] pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('create')}</Button>
      </div>
    </Modal>
  );
}

function CategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal open onClose={onClose} title={t('add_category')}>
      <Field label={t('name')} required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      {error && <div className="mt-3 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button
          disabled={busy || name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try { await api('/api/expenses/categories', { method: 'POST', body: { name: name.trim() } }); onSaved(); }
            catch (e) { setError(errText(e)); }
            finally { setBusy(false); }
          }}
        >{t('create')}</Button>
      </div>
    </Modal>
  );
}
