/**
 * Transactions — the ledger of every movement of money.
 * The list answers three questions at a glance: how much came in, how
 * much went out, and what each individual entry was. Filters stay out
 * of the way until used; a single row opens the full record beside it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile, errText } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls, amountDisplay, parseAmount } from '../lib/format';
import {
  Alert, Badge, Button, Card, DirectionMark, Drawer, EmptyState, Field, Input, Money,
  MoneyInput, PageHeader, Select, SkeletonRows, StatusBadge, Table, Td, Textarea, Toolbar,
  Tr, useLoad, useToast,
} from '../ui/kit';
import NewTransaction from '../ui/NewTransaction';
import { useSession } from '../App';

type Row = any;

export default function Transactions() {
  const { t } = useI18n();
  const { master, can } = useSession()!;
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState({
    range: '', from: '', to: '', service_code: '', type_code: '', status: '', currency: '',
    q: params.get('q') ?? '',
  });
  const [showFilters, setShowFilters] = useState(!!params.get('q'));
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(params.get('id'));

  useEffect(() => {
    const id = params.get('id');
    if (id) setDetailId(id);
    if (params.get('new') === '1' && can('transaction.create')) {
      setCreateOpen(true);
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        p.delete('new');
        return p;
      }, { replace: true });
    }
  }, [params, can, setParams]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters, limit, offset]);

  const { data, loading, refreshing, error, reload } = useLoad(() => api<any>(`/api/transactions?${qs}`), [qs]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('id', id); return p; }, { replace: true });
  };
  const closeDetail = () => {
    setDetailId(null);
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('id'); return p; }, { replace: true });
  };

  const setF = (k: keyof typeof filters) => (e: React.ChangeEvent<any>) => {
    setFilters((x) => ({ ...x, [k]: e.target.value }));
    setOffset(0);
  };

  const activeCount = Object.values(filters).filter(Boolean).length;
  const clearAll = () => {
    setFilters({ range: '', from: '', to: '', service_code: '', type_code: '', status: '', currency: '', q: '' });
    setOffset(0);
  };

  return (
    <div>
      <PageHeader title={t('nav_transactions')} count={data ? data.total : undefined}>
        {can('transaction.create') && <Button onClick={() => setCreateOpen(true)}>＋ {t('new_transaction')}</Button>}
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/transactions?format=csv&${qs}`)}>
          ⬇ {t('export_csv')}
        </Button>
      </PageHeader>

      <Toolbar>
        <Input
          className="max-w-xs"
          placeholder={t('search_placeholder')}
          value={filters.q}
          onChange={setF('q')}
        />
        <Select value={filters.range} onChange={setF('range')} className="w-36" aria-label={t('range')}>
          <option value="">{t('range')}…</option>
          <option value="today">{t('today')}</option>
          <option value="yesterday">{t('yesterday')}</option>
          <option value="week">{t('week')}</option>
          <option value="month">{t('month')}</option>
        </Select>
        <Button
          variant={showFilters || activeCount ? 'primary' : 'outline'}
          onClick={() => setShowFilters((v) => !v)}
        >
          {t('filters')}
          {activeCount > 0 && <span className="num ms-1 rounded bg-white/25 px-1 text-[11px]">{activeCount}</span>}
        </Button>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>{t('clear')}</Button>
        )}
      </Toolbar>

      {showFilters && (
        <Card className="mb-4 p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label={t('from')}><Input type="date" value={filters.from} onChange={setF('from')} /></Field>
            <Field label={t('to')}><Input type="date" value={filters.to} onChange={setF('to')} /></Field>
            <Field label={t('service')}>
              <Select value={filters.service_code} onChange={setF('service_code')}>
                <option value="">{t('all')}</option>
                {master.services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label={t('type')}>
              <Select value={filters.type_code} onChange={setF('type_code')}>
                <option value="">{t('all')}</option>
                {master.transaction_types.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label={t('status')}>
              <Select value={filters.status} onChange={setF('status')}>
                <option value="">{t('all')}</option>
                <option value="completed">{t('status_completed')}</option>
                <option value="pending">{t('status_pending')}</option>
                <option value="cancelled">{t('status_cancelled')}</option>
                <option value="reversed">{t('status_reversed')}</option>
              </Select>
            </Field>
            <Field label={t('currency')}>
              <Select value={filters.currency} onChange={setF('currency')}>
                <option value="">{t('all')}</option>
                {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {error && <Alert tone="err" title={error} />}
      {loading && !data && <Card><SkeletonRows rows={8} cols={6} /></Card>}

      {data && (
        <Card className={cls(refreshing && 'opacity-60 transition')}>
          {/* Totals are per currency — two currencies are two books. */}
          {data.totals.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border-color/[.08] px-4 py-2.5 text-xs">
              {data.totals.map((x: any) => (
                <span key={x.currency} className="text-text-secondary">
                  <b className="text-text-primary">{x.currency}</b>
                  <span className="num ms-1 text-text-muted">({x.tx_count})</span>
                  <span className="ms-2 text-in-600">↓ <b className="num">{amountDisplay(x.inflow_minor)}</b></span>
                  <span className="ms-2 text-out-600">↑ <b className="num">{amountDisplay(x.outflow_minor)}</b></span>
                  <span className="ms-2 text-primary">★ <b className="num">{amountDisplay(x.commission_minor)}</b></span>
                </span>
              ))}
            </div>
          )}

          {data.rows.length === 0 ? (
            <EmptyState
              text={activeCount ? t('no_results') : undefined}
              action={can('transaction.create') && !activeCount
                ? <Button onClick={() => setCreateOpen(true)}>＋ {t('new_transaction')}</Button>
                : undefined}
            />
          ) : (
            <Table head={['', t('txn_number'), t('date'), t('service'), t('customer'), t('amount'), t('commission'), t('status')]}>
              {data.rows.map((r: Row) => (
                <Tr key={r.id} onClick={() => openDetail(String(r.id))}>
                  <Td className="w-8"><DirectionMark direction={r.direction} /></Td>
                  <Td className="doc">{r.tx_number}</Td>
                  <Td className="num text-xs whitespace-nowrap">
                    {r.biz_date} <span className="text-text-muted">{r.time}</span>
                  </Td>
                  <Td className="text-[13px]">
                    {r.service_name}
                    <div className="text-[11px] text-text-muted">{r.type_name}</div>
                  </Td>
                  <Td className="text-[13px]">{r.customer_name || '—'}</Td>
                  <Td>
                    <Money
                      minor={r.amount_minor}
                      currency={r.currency}
                      bold
                      className={r.direction === 'in' ? 'text-in-600' : r.direction === 'out' ? 'text-out-600' : undefined}
                    />
                  </Td>
                  <Td className="text-primary text-[13px]">
                    {r.commission_minor ? <Money minor={r.commission_minor} currency={r.currency} /> : '—'}
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </Tr>
              ))}
            </Table>
          )}

          <div className="flex items-center justify-between border-t border-border-color/[.08] px-4 py-3 text-xs text-text-muted">
            <span className="num">
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, data.total)} / {data.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                {t('back')}
              </Button>
              <Button
                variant="outline" size="sm" disabled={offset + limit >= data.total}
                onClick={() => setOffset(offset + limit)}
              >
                {t('go')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {createOpen && (
        <NewTransaction
          onClose={() => setCreateOpen(false)}
          onCreated={(txn) => {
            setCreateOpen(false);
            reload();
            toast('ok', `${t('created')}: ${txn.tx_number}`);
            openDetail(String(txn.id));
          }}
        />
      )}
      {detailId && <DetailDrawer id={detailId} onClose={closeDetail} onChanged={reload} />}
    </div>
  );
}

/* ---------------- detail ---------------- */

function DetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const { data: txn, loading, reload } = useLoad(() => api<any>(`/api/transactions/${id}`), [id]);
  const [action, setAction] = useState<'reverse' | 'cancel' | 'refund' | 'edit' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (path: string, body: any) => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/transactions/${id}${path}`, { method: 'POST', body });
      toast('ok', t('created'));
      setAction(null);
      reload();
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={txn ? `${t('txn_number')} ${txn.tx_number}` : t('view_detail')}>
      {loading && <SkeletonRows rows={6} cols={3} />}
      {txn && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg border border-border-color/10 bg-surface px-4 py-3">
            <DirectionMark direction={txn.direction} />
            <div className="min-w-0 flex-1">
              <Money minor={txn.amount_minor} currency={txn.currency} bold className="text-lg" />
              <div className="text-xs text-text-muted">{txn.service_name} · {txn.type_name}</div>
            </div>
            <StatusBadge status={txn.status} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label={t('date')} value={`${txn.biz_date} ${txn.time}`} mono />
            <Info label={t('customer')} value={txn.customer_name || '—'} />
            <Info label={t('account')} value={txn.account_name || '—'} />
            <Info label={t('payment_method')} value={txn.payment_method} />
            <Info label={t('commission')} custom={<Money minor={txn.commission_minor} currency={txn.currency} />} />
            <Info label={t('created_by')} value={txn.created_by_name || '—'} />
            {txn.reference_no && <Info label={t('reference_no')} value={txn.reference_no} mono />}
            {txn.wallet_number && <Info label={t('wallet_number')} value={txn.wallet_number} mono />}
            {txn.description && <Info label={t('description')} value={txn.description} className="col-span-2" />}
          </div>

          <div className="flex flex-wrap gap-2 border-y border-border-color/[.07] py-3">
            {can('transaction.reverse') && txn.status === 'completed' && !txn.reversed_by && (
              <Button variant="danger" size="sm" onClick={() => setAction('reverse')}>⟲ {t('reverse')}</Button>
            )}
            {can('transaction.reverse') && txn.status === 'completed' && (
              <Button variant="outline" size="sm" onClick={() => setAction('refund')}>↩ {t('refund')}</Button>
            )}
            {can('transaction.cancel') && txn.status === 'pending' && (
              <Button variant="danger" size="sm" onClick={() => setAction('cancel')}>✕ {t('cancel_txn')}</Button>
            )}
            {can('transaction.edit') && (
              <Button variant="outline" size="sm" onClick={() => setAction('edit')}>✎ {t('edit')}</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => window.print()}>🖨 {t('print')}</Button>
          </div>

          {error && <Alert tone="err" title={error} />}

          <Section title={t('ledger')}>
            {txn.ledger?.length ? (
              <div className="divide-y divide-border-color/[.06]">
                {txn.ledger.map((l: any) => (
                  <div key={l.id} className="flex items-center gap-3 py-2">
                    <DirectionMark direction={l.direction} />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{l.account_name}</span>
                    <Money minor={l.amount_minor} currency={l.currency} bold />
                    <span className="num w-20 shrink-0 text-end text-xs text-text-muted">{l.biz_date}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">— {t('ledger')} ({txn.direction}) —</p>
            )}
          </Section>

          {txn.receipts?.length > 0 && (
            <Section title={t('nav_receipts')}>
              <div className="flex flex-wrap gap-2">
                {txn.receipts.map((r: any) => (
                  <a key={r.id} href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">
                    <Badge kind="blue">{r.receipt_number} · {t('print_count')}: {r.print_count}</Badge>
                  </a>
                ))}
              </div>
            </Section>
          )}

          {txn.related?.length > 0 && (
            <Section title={t('related')}>
              <div className="flex flex-wrap gap-2">
                {txn.related.map((r: any) => (
                  <Badge key={r.id} kind={r.direction === 'in' ? 'ok' : 'gray'}>
                    {r.tx_number} · {amountDisplay(r.amount_minor)} {r.currency}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {txn.audit?.length > 0 && (
            <Section title={t('nav_audit')}>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg bg-surface p-3 text-xs text-text-secondary">
                {txn.audit.map((a: any) => (
                  <div key={a.id}>
                    <b>{a.action}</b> · {a.user_name ?? '—'} ·{' '}
                    <span className="num">{a.created_at?.slice(0, 16).replace('T', ' ')}</span>
                    {a.reason ? ` · ${a.reason}` : ''}
                    {a.old_value && a.new_value ? ` · ${String(a.old_value)} → ${String(a.new_value)}` : ''}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {action && (
            <ActionForm
              kind={action}
              txn={txn}
              busy={busy}
              onCancel={() => { setAction(null); setError(''); }}
              onSubmit={(body) => {
                if (action === 'edit') {
                  setBusy(true);
                  api(`/api/transactions/${id}`, { method: 'PATCH', body })
                    .then(() => { toast('ok', t('created')); setAction(null); reload(); onChanged(); })
                    .catch((e) => setError(errText(e)))
                    .finally(() => setBusy(false));
                } else {
                  run(action === 'refund' ? '/refund' : action === 'reverse' ? '/reverse' : '/cancel', body);
                }
              }}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}

function ActionForm({
  kind, txn, busy, onCancel, onSubmit,
}: { kind: 'reverse' | 'cancel' | 'refund' | 'edit'; txn: any; busy: boolean; onCancel: () => void; onSubmit: (body: any) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [f, setF] = useState({
    amount: amountDisplay(txn.amount_minor),
    commission: amountDisplay(txn.commission_minor),
    reference_no: txn.reference_no ?? '',
    description: txn.description ?? '',
    biz_date: txn.biz_date,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
      <div className="mb-3 text-sm font-bold text-primary">
        {kind === 'reverse' && `⟲ ${t('reverse')}`}
        {kind === 'cancel' && `✕ ${t('cancel_txn')}`}
        {kind === 'refund' && `↩ ${t('refund')}`}
        {kind === 'edit' && `✎ ${t('edit')}`}
      </div>

      {kind === 'edit' && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('amount')}><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
          <Field label={t('commission')}><MoneyInput value={f.commission} onChange={set('commission')} /></Field>
          <Field label={t('reference_no')}><Input value={f.reference_no} onChange={set('reference_no')} /></Field>
          <Field label={t('biz_date')}><Input type="date" value={f.biz_date} onChange={set('biz_date')} /></Field>
          <Field label={t('description')} className="sm:col-span-2">
            <Textarea value={f.description} onChange={set('description')} rows={2} />
          </Field>
        </div>
      )}

      {kind === 'refund' && (
        <Field
          label={`${t('refund')} (${t('optional')})`}
          hint={`${t('total')}: ${amountDisplay(txn.amount_minor)} ${txn.currency}`}
        >
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={amountDisplay(txn.amount_minor)} />
        </Field>
      )}

      <Field label={t('reason')} required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>{t('cancel')}</Button>
        <Button
          variant={kind === 'edit' ? 'primary' : 'danger'}
          size="sm" disabled={busy || reason.trim().length < 3}
          onClick={() => {
            const body: any = { reason: reason.trim() };
            if (kind === 'edit') {
              const a = parseAmount(f.amount);
              const c = parseAmount(f.commission);
              if (a !== null) body.amount_minor = a;
              if (c !== null) body.commission_minor = c;
              body.reference_no = f.reference_no;
              body.description = f.description;
              body.biz_date = f.biz_date;
            }
            if (kind === 'refund' && amount) body.amount = amount.replace(/,/g, '');
            onSubmit(body);
          }}
        >
          {t('confirm')}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-semibold text-text-secondary">{title}</h4>
      {children}
    </div>
  );
}

function Info({ label, value, custom, mono, className }: {
  label: string; value?: string; custom?: React.ReactNode; mono?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold text-text-muted">{label}</div>
      <div className={cls('mt-0.5 text-text-primary', mono && 'doc')}>{custom ?? value ?? '—'}</div>
    </div>
  );
}
