import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText, downloadFile } from '../lib/api';
import { useDraft } from '../lib/draft';
import { useI18n } from '../lib/i18n';
import { cls, amountDisplay, parseAmount, todayISO } from '../lib/format';
import {
  Alert, Button, Card, EmptyState, Field, Input, Modal, Money, MoneyInput, PageHeader,
  Select, Spinner, StatusBadge, Table, Td, Textarea, useLoad, useToast,
} from '../ui/kit';
import { CustomerPicker } from '../ui/NewTransaction';
import { useSession } from '../App';

type Contract = any;

export default function Ronaki() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  // The dashboard quick action links here with ?new=1; global search uses ?id=<contract>.
  useEffect(() => {
    if (params.get('new') === '1' && can('ronaki.create')) {
      setNewOpen(true);
      setParams((prev) => { const p = new URLSearchParams(prev); p.delete('new'); return p; }, { replace: true });
      return;
    }
    const raw = params.get('id');
    if (raw && Number.isFinite(Number(raw))) {
      setDetail({ id: Number(raw) });
      setParams((prev) => { const p = new URLSearchParams(prev); p.delete('id'); return p; }, { replace: true });
    }
  }, [params, can, setParams]);
  const [payContract, setPayContract] = useState<Contract | null>(null);
  const [detail, setDetail] = useState<Contract | null>(null);

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  if (projectId) qs.set('project_id', projectId);

  const { data, loading, error, reload } = useLoad(() => api<any>(`/api/ronaki/contracts?${qs}`), [qs.toString()]);
  const projects = useLoad(() => api<any>('/api/ronaki/projects'), []);

  return (
    <div>
      <PageHeader title={t('nav_ronaki')} subtitle={data ? `${data.summary.total_customers}` : ''}>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/ronaki?format=csv&${qs}`)}>⬇ {t('export_csv')}</Button>
        {can('ronaki.create') && <Button onClick={() => setNewOpen(true)}>＋ {t('new_contract')}</Button>}
      </PageHeader>

      {/* summary */}
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SumCard label={t('total')} value={String(data.summary.total_customers)} />
          <SumCard label={t('status_unpaid')} value={String(data.summary.by_status.unpaid)} tone="gray" />
          <SumCard label={t('status_partially_paid')} value={String(data.summary.by_status.partially_paid)} tone="amber" />
          <SumCard label={t('status_paid')} value={String(data.summary.by_status.paid)} tone="green" />
          <SumCard label={t('status_overdue')} value={String(data.summary.by_status.overdue)} tone="red" />
        </div>
      )}
      {data?.summary?.totals?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {data.summary.totals.map((x: any) => (
            <Card key={x.currency} className="flex gap-5 px-4 py-2.5 text-xs">
              <span><b>{x.currency}</b> {t('total_required')}: <b className="num">{amountDisplay(x.total_required_minor)}</b></span>
              <span>{t('paid')}: <b className="text-in-600 num">{amountDisplay(x.paid_minor)}</b></span>
              <span>{t('remaining')}: <b className="text-primary num">{amountDisplay(x.remaining_minor)}</b></span>
            </Card>
          ))}
        </div>
      )}

      {/* filters */}
      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Input placeholder={t('search') + '…'} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('status')}: {t('all')}</option>
            <option value="unpaid">{t('status_unpaid')}</option>
            <option value="partially_paid">{t('status_partially_paid')}</option>
            <option value="paid">{t('status_paid')}</option>
            <option value="overdue">{t('status_overdue')}</option>
          </Select>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t('project')}: {t('all')}</option>
            {projects.data?.projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); setProjectId(''); }}>{t('clear')}</Button>
        </div>
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('code'), t('customer'), t('house_unit'), t('total_required'), t('paid'), t('remaining'), t('due_date'), t('status'), t('actions')]}>
              {data.rows.map((c: Contract) => (
                <tr key={c.id} className="hover:bg-surface">
                  <Td className="font-semibold num text-xs">{c.contract_number}</Td>
                  <Td className="text-xs">{c.customer_name || c.customer_ref || '—'}<div className="text-[10px] text-text-muted num">{c.customer_phone ?? ''}</div></Td>
                  <Td className="text-xs num">{c.house_unit || '—'}</Td>
                  <Td><Money minor={c.total_required_minor} currency={c.currency} /></Td>
                  <Td className="text-in-600"><Money minor={c.paid_minor} currency={c.currency} /></Td>
                  <Td className="font-bold text-primary"><Money minor={c.remaining_minor} currency={c.currency} /></Td>
                  <Td className="num text-xs">{c.due_date || '—'}</Td>
                  <Td><StatusBadge status={c.status} /></Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(c)}>…</Button>
                      {can('ronaki.payment') && c.remaining_minor > 0 && (
                        <Button variant="success" size="sm" onClick={() => setPayContract(c)}>＋ {t('add_payment')}</Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {newOpen && <NewContractModal projects={projects.data?.projects ?? []} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload(); toast('ok', t('created')); }} />}
      {payContract && <PayModal contract={payContract} onClose={() => setPayContract(null)} onPaid={() => { setPayContract(null); reload(); toast('ok', t('paid')); }} />}
      {detail && <ContractDetail contractId={detail.id} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function SumCard({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' | 'amber' | 'gray' }) {
  const tones = { red: 'text-out-600', green: 'text-in-600', amber: 'text-amber-600', gray: 'text-text-secondary' };
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] font-semibold text-text-muted">{label}</div>
      <div className={cls('mt-1 text-xl font-bold', tone ? tones[tone] : 'text-text-primary')}>{value}</div>
    </Card>
  );
}

function NewContractModal({ projects, onClose, onCreated }: { projects: any[]; onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const { master, meta } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = {
    contract_number: '', project_id: projects[0]?.id ?? '', customer_id: '', house_unit: '', customer_ref: '',
    total_required: '', currency: meta.defaultCurrency, start_date: todayISO(), due_date: '', notes: '',
  };
  const draft = useDraft('ronaki.contract', blank);
  const [f, setF] = useState(() => draft.restored ?? blank);
  const update = (patch: Partial<typeof blank>) => setF((x) => {
    const next = { ...x, ...patch };
    draft.set(next);
    return next;
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<any>) => update({ [k]: e.target.value } as any);

  const submit = async () => {
    setError('');
    if (!f.contract_number.trim()) return setError(`${t('code')} — ${t('required')}`);
    if (parseAmount(f.total_required) === null) return setError(`${t('total_required')} — ${t('required')}`);
    setBusy(true);
    try {
      await api('/api/ronaki/contracts', {
        method: 'POST',
        body: {
          contract_number: f.contract_number, project_id: Number(f.project_id),
          customer_id: f.customer_id ? Number(f.customer_id) : undefined,
          house_unit: f.house_unit, customer_ref: f.customer_ref,
          total_required: f.total_required.replace(/,/g, ''), currency: f.currency,
          start_date: f.start_date || undefined, due_date: f.due_date || undefined, notes: f.notes,
        },
      });
      draft.clear();
      onCreated();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('new_contract')}>
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
        <Field label={t('code')} required><Input value={f.contract_number} onChange={set('contract_number')} dir="ltr" /></Field>
        <Field label={t('project')} required>
          <Select value={f.project_id} onChange={set('project_id')}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {projects.length === 0 && <option value="">—</option>}
          </Select>
        </Field>
        <Field label={t('customer')} className="sm:col-span-2">
          <CustomerPicker value={f.customer_id} onChange={(v: string) => update({ customer_id: v })} />
        </Field>
        <Field label={t('house_unit')}><Input value={f.house_unit} onChange={set('house_unit')} /></Field>
        <Field label={t('code') + ' — ref'}><Input value={f.customer_ref} onChange={set('customer_ref')} dir="ltr" /></Field>
        <Field label={t('total_required')} required><MoneyInput value={f.total_required} onChange={set('total_required')} /></Field>
        <Field label={t('currency')} required>
          <Select value={f.currency} onChange={set('currency')}>
            {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
        </Field>
        <Field label={t('date')}><Input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label={t('due_date')}><Input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label={t('notes')} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color/[.08] pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('create')}</Button>
      </div>
    </Modal>
  );
}

function PayModal({ contract, onClose, onPaid }: { contract: Contract; onClose: () => void; onPaid: () => void }) {
  const { t } = useI18n();
  const { master } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = {
    amount: '', currency: contract.currency, account_id: String(master.accounts.find((a) => a.code === 'CASH')?.id ?? ''),
    payment_method: 'cash', biz_date: todayISO(), notes: '', receipt: true,
  };
  // Keyed by contract: a payment half-entered against one house must not
  // reappear against another.
  const draft = useDraft(`ronaki.pay.${contract.id}`, blank);
  const [f, setF] = useState(() => draft.restored ?? blank);
  const update = (patch: Partial<typeof blank>) => setF((x) => {
    const next = { ...x, ...patch };
    draft.set(next);
    return next;
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<any>) =>
    update({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } as any);

  const submit = async () => {
    setError('');
    if (parseAmount(f.amount) === null) return setError(`${t('amount')} — ${t('required')}`);
    setBusy(true);
    try {
      await api(`/api/ronaki/contracts/${contract.id}/payments`, {
        method: 'POST',
        body: {
          amount: f.amount.replace(/,/g, ''), currency: f.currency, account_id: Number(f.account_id),
          payment_method: f.payment_method, biz_date: f.biz_date, notes: f.notes, receipt: f.receipt,
        },
      });
      draft.clear();
      onPaid();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`${t('add_payment')} — ${contract.contract_number}`}>
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
      <div className="mb-3 rounded-lg bg-surface p-3 text-sm">
        <div className="flex justify-between"><span>{t('total_required')}</span><Money minor={contract.total_required_minor} currency={contract.currency} bold /></div>
        <div className="flex justify-between text-in-600"><span>{t('paid')}</span><Money minor={contract.paid_minor} currency={contract.currency} /></div>
        <div className="flex justify-between font-bold text-primary"><span>{t('remaining')}</span><Money minor={contract.remaining_minor} currency={contract.currency} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('amount')} required><MoneyInput value={f.amount} onChange={set('amount')} autoFocus /></Field>
        <Field label={t('account')}>
          <Select value={f.account_id} onChange={set('account_id')}>
            {master.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={t('date')}><Input type="date" value={f.biz_date} onChange={set('biz_date')} /></Field>
        <Field label={t('payment_method')}>
          <Select value={f.payment_method} onChange={set('payment_method')}>
            {master.payment_methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('notes')} className="sm:col-span-2"><Input value={f.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={f.receipt} onChange={set('receipt')} className="accent-primary" /> {t('receipt_number')}
        </label>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color/[.08] pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="success" onClick={submit} disabled={busy}>{busy ? t('loading') : t('confirm')}</Button>
      </div>
    </Modal>
  );
}

function ContractDetail({ contractId, onClose, onChanged }: { contractId: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { data, loading, reload } = useLoad(() => api<any>(`/api/ronaki/contracts/${contractId}`), [contractId]);
  void onChanged;

  return (
    <Modal open onClose={onClose} title={data ? `${t('code')}: ${data.contract_number}` : t('view_detail')} wide>
      {loading && <Spinner />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-[11px] text-text-muted">{t('customer')}</div><b>{data.customer_name || data.customer_ref}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('project')}</div><b>{data.project_name}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('house_unit')}</div><b className="num">{data.house_unit || '—'}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('status')}</div><StatusBadge status={data.status} /></div>
            <div><div className="text-[11px] text-text-muted">{t('total_required')}</div><Money minor={data.total_required_minor} currency={data.currency} bold /></div>
            <div><div className="text-[11px] text-text-muted">{t('paid')}</div><span className="text-in-600"><Money minor={data.paid_minor} currency={data.currency} /></span></div>
            <div><div className="text-[11px] text-text-muted">{t('remaining')}</div><span className="text-primary font-bold"><Money minor={data.remaining_minor} currency={data.currency} /></span></div>
            <div><div className="text-[11px] text-text-muted">{t('due_date')}</div><b className="num">{data.due_date || '—'}</b></div>
          </div>

          <div>
            <h4 className="mb-1.5 text-xs font-bold text-text-muted">{t('payments')}</h4>
            {data.payments?.length ? (
              <Table head={[t('receipt_number'), t('date'), t('amount'), t('note'), t('created_by')]}>
                {data.payments.map((p: any) => (
                  <tr key={p.id}>
                    <Td className="num text-xs font-semibold">{p.payment_number}</Td>
                    <Td className="num text-xs">{p.biz_date}</Td>
                    <Td className="text-in-600 font-bold"><Money minor={p.amount_minor} currency={p.currency} /></Td>
                    <Td className="text-xs">{p.notes || '—'}</Td>
                    <Td className="text-xs">{p.created_by_name}</Td>
                  </tr>
                ))}
              </Table>
            ) : <EmptyState />}
          </div>
          <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={reload}>⟳ {t('refresh')}</Button></div>
        </div>
      )}
    </Modal>
  );
}
