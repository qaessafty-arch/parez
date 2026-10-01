import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls } from '../lib/format';
import {
  Button, Card, EmptyState, Field, Input, Modal, Money, PageHeader, Spinner,
  StatusBadge, Table, Td, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

type Customer = any;

export default function Customers() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Customer | 'new' | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();

  // global search links here as /customers?id=<id>
  useEffect(() => {
    const raw = params.get('id');
    if (!raw) return;
    const id = Number(raw);
    if (Number.isFinite(id)) setHistoryId(id);
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('id'); return p; }, { replace: true });
  }, [params, setParams]);

  const qs = `q=${encodeURIComponent(q)}&limit=100`;
  const { data, loading, error, reload } = useLoad(() => api<any>(`/api/customers?${qs}`), [qs]);

  return (
    <div>
      <PageHeader title={t('nav_customers')} subtitle={data ? String(data.total) : ''}>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/customer_debt?format=csv`)}>⬇ {t('export_csv')}</Button>
        {can('customer.create') && <Button onClick={() => setEdit('new')}>＋ {t('new_customer')}</Button>}
      </PageHeader>

      <Card className="mb-4 p-3">
        <Input placeholder={t('search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('code'), t('name'), t('phone'), t('address'), t('created'), t('actions')]}>
              {data.rows.map((c: Customer) => (
                <tr key={c.id} className="hover:bg-surface">
                  <Td className="num text-xs font-semibold">{c.code}</Td>
                  <Td className="font-medium">{c.full_name}</Td>
                  <Td className="num text-xs">{c.phone || '—'}</Td>
                  <Td className="text-xs">{c.address || '—'}</Td>
                  <Td className="num text-xs">{c.created_at?.slice(0, 10)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setHistoryId(c.id)}>{t('history')}</Button>
                      {can('customer.edit') && <Button variant="outline" size="sm" onClick={() => setEdit(c)}>{t('edit')}</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {edit && (
        <CustomerModal
          customer={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload(); toast('ok', t('save')); }}
        />
      )}
      {historyId !== null && <HistoryModal id={historyId} onClose={() => setHistoryId(null)} />}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ full_name: customer?.full_name ?? '', phone: customer?.phone ?? '', address: customer?.address ?? '', notes: customer?.notes ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setError('');
    if (f.full_name.trim().length < 2) return setError(`${t('name')} — ${t('required')}`);
    setBusy(true);
    try {
      if (customer) await api(`/api/customers/${customer.id}`, { method: 'PATCH', body: f });
      else await api('/api/customers', { method: 'POST', body: f });
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={customer ? `${t('edit')} — ${customer.full_name}` : t('new_customer')}>
      <div className="space-y-4">
        <Field label={t('name')} required><Input value={f.full_name} onChange={set('full_name')} autoFocus /></Field>
        <Field label={t('phone')}><Input value={f.phone} onChange={set('phone')} dir="ltr" placeholder="0750…" /></Field>
        <Field label={t('address')}><Input value={f.address} onChange={set('address')} /></Field>
        <Field label={t('notes')}><Input value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}

function HistoryModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const { data, loading } = useLoad(() => api<any>(`/api/customers/${id}/history`), [id]);
  const [tab, setTab] = useState<'txns' | 'contracts' | 'payments'>('txns');

  return (
    <Modal open onClose={onClose} title={data ? `${t('history')} — ${data.customer.full_name}` : t('history')} wide>
      {loading && <Spinner />}
      {data && (
        <div className="space-y-4">
          {/* per-currency totals */}
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-surface p-3">
              <div className="text-[11px] text-text-secondary">{t('paid')}</div>
              {data.totals.total_paid_by_currency.length
                ? data.totals.total_paid_by_currency.map((x: any) => <div key={x.currency} className="font-bold text-in-600"><Money minor={x.amount_minor} currency={x.currency} /></div>)
                : <span className="text-text-secondary">—</span>}
            </div>
            <div className="rounded-lg bg-surface p-3">
              <div className="text-[11px] text-text-secondary">{t('outstanding')}</div>
              {data.totals.outstanding_by_currency.length
                ? data.totals.outstanding_by_currency.map((x: any) => <div key={x.currency} className="font-bold text-out-600"><Money minor={x.outstanding_minor} currency={x.currency} /></div>)
                : <span className="text-text-secondary">0</span>}
            </div>
            <div className="rounded-lg bg-surface p-3">
              <div className="text-[11px] text-text-secondary">{t('dash_ronaki_remaining')}</div>
              {data.totals.ronaki_remaining_by_currency.length
                ? data.totals.ronaki_remaining_by_currency.map((x: any) => <div key={x.currency} className="font-bold text-emerald-600"><Money minor={x.remaining_minor} currency={x.currency} /></div>)
                : <span className="text-text-secondary">—</span>}
            </div>
          </div>

          <div className="flex gap-1 border-b border-border-color">
            {(['txns', 'contracts', 'payments'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cls('border-b-2 px-3 py-2 text-sm font-semibold',
                  tab === k ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-text-secondary')}
              >
                {k === 'txns' ? t('nav_transactions') : k === 'contracts' ? t('contracts') : t('payments')}
              </button>
            ))}
          </div>

          {tab === 'txns' && (data.transactions.length ? (
            <Table head={[t('txn_number'), t('date'), t('service'), t('amount'), t('status')]}>
              {data.transactions.map((r: any) => (
                <tr key={r.id}>
                  <Td className="num text-xs font-semibold">{r.tx_number}</Td>
                  <Td className="num text-xs">{r.biz_date}</Td>
                  <Td className="text-xs">{r.service_name} · {r.type_name}</Td>
                  <Td className={cls('font-bold', r.direction === 'in' ? 'text-in-600' : 'text-out-600')}>
                    <Money minor={r.amount_minor} currency={r.currency} />
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState />)}

          {tab === 'contracts' && (data.contracts.length ? (
            <Table head={[t('code'), t('house_unit'), t('total_required'), t('paid'), t('remaining'), t('status')]}>
              {data.contracts.map((c: any) => (
                <tr key={c.id}>
                  <Td className="num text-xs font-semibold">{c.contract_number}</Td>
                  <Td className="num text-xs">{c.house_unit || '—'}</Td>
                  <Td><Money minor={c.total_required_minor} currency={c.currency} /></Td>
                  <Td className="text-in-600"><Money minor={c.paid_minor} currency={c.currency} /></Td>
                  <Td className="font-bold text-emerald-600"><Money minor={c.remaining_minor} currency={c.currency} /></Td>
                  <Td><StatusBadge status={c.status} /></Td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState />)}

          {tab === 'payments' && (data.ronakiPayments.length ? (
            <Table head={[t('receipt_number'), t('code'), t('date'), t('amount')]}>
              {data.ronakiPayments.map((p: any) => (
                <tr key={p.id}>
                  <Td className="num text-xs font-semibold">{p.payment_number}</Td>
                  <Td className="num text-xs">{p.contract_number}</Td>
                  <Td className="num text-xs">{p.biz_date}</Td>
                  <Td className="text-in-600 font-bold"><Money minor={p.amount_minor} currency={p.currency} /></Td>
                </tr>
              ))}
            </Table>
          ) : <EmptyState />)}
        </div>
      )}
    </Modal>
  );
}
