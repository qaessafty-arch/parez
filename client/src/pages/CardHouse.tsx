import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText, downloadFile } from '../lib/api';
import { useDraft } from '../lib/draft';
import { useI18n } from '../lib/i18n';
import { cls, amountDisplay, parseAmount, todayISO } from '../lib/format';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, Money, MoneyInput, PageHeader,
  Select, Spinner, StatusBadge, Table, Td, Textarea, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

type CardSale = any;

export default function CardHousePage() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cardType, setCardType] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get('new') === '1' && can('cardhouse.create')) {
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

  const [detail, setDetail] = useState<CardSale | null>(null);

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  if (cardType) qs.set('card_type', cardType);

  const { data, loading, error, reload } = useLoad(() => api<any>(`/api/cardhouse/transactions?${qs}`), [qs.toString()]);
  const summary = useLoad(() => api<any>(`/api/cardhouse/summary?range=today`), []);

  return (
    <div>
      <PageHeader title={t('nav_cardhouse')} subtitle={summary.data ? `${t('period')}: ${summary.data.range.from} → ${summary.data.range.to}` : ''}>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/cardhouse?format=csv&from=${summary.data?.range.from}&to=${summary.data?.range.to}`)}>⬇ {t('export_csv')}</Button>
        {can('cardhouse.create') && <Button onClick={() => setNewOpen(true)}>＋ {t('new_transaction')}</Button>}
      </PageHeader>

      {/* summary cards */}
      {summary.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SumCard label={t('cash_in')} value={amountDisplay(summary.data.period[0]?.inflow_minor ?? 0)} currency={summary.data.period[0]?.currency ?? 'IQD'} tone="green" />
          <SumCard label={t('cash_out')} value={amountDisplay(summary.data.period[0]?.outflow_minor ?? 0)} currency={summary.data.period[0]?.currency ?? 'IQD'} tone="red" />
          <SumCard label={t('commission')} value={amountDisplay(summary.data.period[0]?.commission_minor ?? 0)} currency={summary.data.period[0]?.currency ?? 'IQD'} tone="blue" />
          <SumCard label={t('wallet_balances')} value={amountDisplay(summary.data.balances?.[0]?.balance_minor ?? 0)} currency={summary.data.balances?.[0]?.currency ?? 'IQD'} tone="gray" />
        </div>
      )}

      {/* balances by currency */}
      {summary.data?.balances?.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {summary.data.balances.map((b: any) => (
            <Card key={`${b.account_id}-${b.currency}`} className="flex gap-5 px-4 py-2.5 text-xs">
              <span><b>{b.account_name}</b> ({b.account_code})</span>
              <span>{t('balance')}: <b className="num">{amountDisplay(b.balance_minor)}</b> {b.currency}</span>
              <span>{t('opening')}: <b className="num">{amountDisplay(b.opening_balance_minor)}</b></span>
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
            <option value="completed">{t('status_completed')}</option>
            <option value="pending">{t('status_pending')}</option>
            <option value="cancelled">{t('status_cancelled')}</option>
            <option value="reversed">{t('status_reversed')}</option>
          </Select>
          <Select value={cardType} onChange={(e) => setCardType(e.target.value)}>
            <option value="">{t('card_type')}: {t('all')}</option>
            <option value="pubg">{t('card_pubg')}</option>
            <option value="steam">{t('card_steam')}</option>
            <option value="apple">{t('card_apple')}</option>
            <option value="google">{t('card_google')}</option>
            <option value="telecom">{t('card_telecom')}</option>
            <option value="custom">{t('card_custom')}</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setStatus(''); setCardType(''); }}>{t('clear')}</Button>
        </div>
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('txn_number'), t('date'), t('type'), t('card_type'), t('amount'), t('commission'), t('status'), t('actions')]}>
              {data.rows.map((r: CardSale) => (
                <tr key={r.id} className="hover:bg-surface">
                  <Td className="font-semibold num text-xs">{r.tx_number}</Td>
                  <Td className="num text-xs">{r.biz_date} <span className="text-text-muted">{r.time}</span></Td>
                  <Td className="text-[13px]">{r.type_name}</Td>
                  <Td>
                    <Badge kind="blue">{r.card_type ? t(`card_${r.card_type}` as never) : '—'}</Badge>
                  </Td>
                  <Td>
                    <Money
                      minor={r.amount_minor} currency={r.currency} bold
                      className={r.direction === 'in' ? 'text-in-600' : 'text-out-600'}
                    />
                  </Td>
                  <Td className="text-primary text-[13px]">
                    {r.commission_minor ? <Money minor={r.commission_minor} currency={r.currency} /> : '—'}
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>
                    <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>…</Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {newOpen && <NewCardSaleModal onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); reload(); toast('ok', t('created')); }} />}
      {detail && <CardSaleDetail cardSaleId={detail.id} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function SumCard({ label, value, currency, tone }: { label: string; value: string; currency: string; tone?: 'red' | 'green' | 'blue' | 'gray' }) {
  const tones = { red: 'text-out-600', green: 'text-in-600', blue: 'text-info-600', gray: 'text-text-secondary' };
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] font-semibold text-text-muted">{label}</div>
      <div className={cls('mt-1 text-xl font-bold', tone ? tones[tone] : 'text-text-primary')}>
        <Money minor={parseInt(value.replace(/,/g, '')) || 0} currency={currency} bold />
      </div>
    </Card>
  );
}

function NewCardSaleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const { master, meta } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blank = {
    service_code: 'cardhouse',
    type_code: 'deposit',
    account_id: String(master.accounts.find((a) => a.code === 'CARDHOUSE')?.id ?? ''),
    amount: '',
    currency: meta.defaultCurrency,
    commission: '',
    payment_method: 'cardhouse',
    wallet_number: '',
    reference_no: '',
    card_type: 'pubg',
    description: '',
    biz_date: todayISO(),
    status: 'completed',
    receipt: true,
  };
  const draft = useDraft('cardhouse.sale', blank);
  const [f, setF] = useState(() => draft.restored ?? blank);
  const update = (patch: Partial<typeof blank>) => setF((x) => {
    const next = { ...x, ...patch };
    draft.set(next);
    return next;
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<any>) => update({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } as any);

  const submit = async () => {
    setError('');
    if (parseAmount(f.amount) === null) return setError(`${t('amount')} — ${t('required')}`);
    setBusy(true);
    try {
      await api('/api/transactions', {
        method: 'POST',
        body: {
          service_code: f.service_code,
          type_code: f.type_code,
          account_id: Number(f.account_id),
          amount: f.amount.replace(/,/g, ''),
          currency: f.currency,
          commission: f.commission ? f.commission.replace(/,/g, '') : undefined,
          payment_method: f.payment_method,
          wallet_number: f.wallet_number,
          reference_no: f.reference_no,
          card_type: f.card_type,
          description: f.description,
          biz_date: f.biz_date,
          status: f.status,
          receipt: f.receipt,
        },
      });
      draft.clear();
      onCreated();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={t('new_transaction') + ' — ' + t('nav_cardhouse')}>
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
        <Field label={t('amount')} required><MoneyInput value={f.amount} onChange={set('amount')} autoFocus /></Field>
        <Field label={t('currency')} required>
          <Select value={f.currency} onChange={set('currency')}>
            {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </Select>
        </Field>
        <Field label={t('commission')}><MoneyInput value={f.commission} onChange={set('commission')} placeholder={t('auto_commission')} /></Field>
        <Field label={t('biz_date')} required><Input type="date" value={f.biz_date} onChange={set('biz_date')} /></Field>
        <Field label={t('payment_method')}>
          <Select value={f.payment_method} onChange={set('payment_method')}>
            {master.payment_methods.filter((m) => ['cardhouse', 'cash', 'bank'].includes(m.code)).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label={t('card_type')}>
          <Select value={f.card_type} onChange={set('card_type')}>
            <option value="pubg">{t('card_pubg')}</option>
            <option value="steam">{t('card_steam')}</option>
            <option value="apple">{t('card_apple')}</option>
            <option value="google">{t('card_google')}</option>
            <option value="telecom">{t('card_telecom')}</option>
            <option value="custom">{t('card_custom')}</option>
          </Select>
        </Field>
        <Field label={t('wallet_number')}>
          <Input value={f.wallet_number} onChange={set('wallet_number')} dir="ltr" inputMode="numeric" placeholder="Card/Account number" />
        </Field>
        <Field label={t('reference_no')}>
          <Input value={f.reference_no} onChange={set('reference_no')} dir="ltr" placeholder="Provider reference" />
        </Field>
        <Field label={t('description')} className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={set('description')} /></Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary sm:col-span-2">
          <input type="checkbox" checked={f.receipt} onChange={set('receipt')} className="h-4 w-4 accent-emerald-600" />
          {t('print')}
        </label>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color/[.08] pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('create')}</Button>
      </div>
    </Modal>
  );
}

function CardSaleDetail({ cardSaleId, onClose, onChanged }: { cardSaleId: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { data, loading, reload } = useLoad(() => api<any>(`/api/transactions/${cardSaleId}`), [cardSaleId]);
  void onChanged;

  return (
    <Modal open onClose={onClose} title={data ? `${t('txn_number')}: ${data.tx_number}` : t('view_detail')} wide>
      {loading && <Spinner />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-[11px] text-text-muted">{t('txn_number')}</div><b>{data.tx_number}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('date')}</div><b className="num">{data.biz_date}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('type')}</div><b>{data.type_name}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('card_type')}</div><Badge kind="blue">{data.card_type ? t(`card_${data.card_type}` as never) : '—'}</Badge></div>
            <div><div className="text-[11px] text-text-muted">{t('amount')}</div><Money minor={data.amount_minor} currency={data.currency} bold className={data.direction === 'in' ? 'text-in-600' : 'text-out-600'} /></div>
            <div><div className="text-[11px] text-text-muted">{t('commission')}</div><span className="text-primary"><Money minor={data.commission_minor} currency={data.currency} /></span></div>
            <div><div className="text-[11px] text-text-muted">{t('status')}</div><StatusBadge status={data.status} /></div>
            <div><div className="text-[11px] text-text-muted">{t('wallet_number')}</div><b className="num">{data.wallet_number || '—'}</b></div>
            <div><div className="text-[11px] text-text-muted">{t('reference_no')}</div><b className="num">{data.reference_no || '—'}</b></div>
            <div className="sm:col-span-2"><div className="text-[11px] text-text-muted">{t('description')}</div><span className="text-xs">{data.description || '—'}</span></div>
            <div className="sm:col-span-2"><div className="text-[11px] text-text-muted">{t('created_by')}</div><b>{data.created_by_name || '—'}</b></div>
          </div>
          <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={reload}>⟳ {t('refresh')}</Button></div>
        </div>
      )}
    </Modal>
  );
}