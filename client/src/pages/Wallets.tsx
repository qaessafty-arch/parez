/**
 * Wallets (FastPay / NassWallet) — one screen per service: what came in,
 * what went out, the commission earned, and the balance of every
 * account. Amounts are grouped per currency and never added together.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { amountDisplay, cls } from '../lib/format';
import {
  Alert, Button, Card, DirectionMark, EmptyState, Money, PageHeader, Segmented, SkeletonRows,
  StatusBadge, Table, Td, Tr, useLoad,
} from '../ui/kit';
import NewTransaction from '../ui/NewTransaction';
import { useSession } from '../App';

const RANGES = ['today', 'yesterday', 'week', 'month'] as const;

export default function Wallets({ serviceCode }: { serviceCode: 'fastpay' | 'nasswallet' }) {
  const { t } = useI18n();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const range = params.get('range') || 'today';
  const [createOpen, setCreateOpen] = useState(false);

  const qs = `range=${range}`;
  const { data, loading, error, reload } = useLoad(
    () => api<any>(`/api/${serviceCode}/summary?${qs}`),
    [serviceCode, qs]
  );
  const txns = useLoad(() => api<any>(`/api/${serviceCode}/transactions?${qs}&limit=50`), [serviceCode, qs]);

  const title = serviceCode === 'fastpay' ? t('nav_fastpay') : t('nav_nasswallet');

  return (
    <div>
      <PageHeader title={title} subtitle={data ? `${data.range.from} → ${data.range.to}` : ''}>
        <Segmented
          value={range}
          onChange={(v) => { const p = new URLSearchParams(params); p.set('range', v); setParams(p); }}
          options={RANGES.map((r) => ({ value: r, label: t(r as never) }))}
        />
        <Button variant="outline" size="sm"
          onClick={() => downloadFile(`/api/reports/${serviceCode}?format=csv&from=${data?.range.from}&to=${data?.range.to}`)}>
          ⬇ {t('export_csv')}
        </Button>
        {can('transaction.create') && <Button onClick={() => setCreateOpen(true)}>＋ {t('new_transaction')}</Button>}
      </PageHeader>

      {error && <Alert tone="err" title={error} />}
      {loading && !data && <Card><SkeletonRows rows={6} cols={4} /></Card>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[
              { label: t('period'), rows: data.period },
              { label: t('lifetime'), rows: data.lifetime },
            ].map((block) => (
              <Card key={block.label} className="p-5">
                <h3 className="mb-3 text-sm font-bold text-text-primary">{block.label}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {block.rows?.map((r: any) => (
                    <div key={r.currency} className="rounded-lg border border-border-color/[.08] p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[12px] font-bold text-text-secondary">{r.currency}</span>
                        <span className="num text-[11px] text-text-muted">{r.tx_count} ×</span>
                      </div>
                      <div className="space-y-1">
                        <Row label={t('cash_in')} dir="in">
                          <Money minor={r.inflow_minor} currency={r.currency} bold />
                        </Row>
                        <Row label={t('cash_out')} dir="out">
                          <Money minor={r.outflow_minor} currency={r.currency} bold />
                        </Row>
                        <Row label={t('commission')}>
                          <Money minor={r.commission_minor} currency={r.currency} className="text-primary" bold />
                        </Row>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Card className="mb-4 p-5">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('wallet_balances')}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.balances?.length ? data.balances.map((b: any) => (
                <div key={`${b.account_id}-${b.currency}`} className="flex items-center justify-between rounded-lg border border-border-color/[.08] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-text-primary">{b.account_name}</div>
                    <div className="doc">{b.account_code}</div>
                  </div>
                  <div className="text-end">
                    <Money minor={b.balance_minor} currency={b.currency} bold />
                    <div className="text-[10px] text-text-muted">
                      {t('opening')}: <span className="num">{amountDisplay(b.opening_balance_minor)}</span>
                    </div>
                  </div>
                </div>
              )) : <EmptyState />}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-border-color/[.08] px-4 py-3">
              <h3 className="text-sm font-bold text-text-primary">{t('nav_transactions')}</h3>
              <Button variant="ghost" size="sm" onClick={() => { reload(); txns.reload(); }}>⟳ {t('refresh')}</Button>
            </div>
            {txns.loading && !txns.data ? <SkeletonRows rows={6} cols={5} /> : (txns.data?.rows?.length ? (
              <Table head={['', t('txn_number'), t('date'), t('type'), t('amount'), t('commission'), t('status')]}>
                {txns.data.rows.map((r: any) => (
                  <Tr key={r.id} onClick={() => { window.location.href = `/transactions?id=${r.id}`; }}>
                    <Td className="w-8"><DirectionMark direction={r.direction} /></Td>
                    <Td className="doc">{r.tx_number}</Td>
                    <Td className="num text-xs">{r.biz_date} <span className="text-text-muted">{r.time}</span></Td>
                    <Td className="text-[13px]">{r.type_name}</Td>
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
                  </Tr>
                ))}
              </Table>
            ) : <EmptyState action={can('transaction.create')
              ? <Button onClick={() => setCreateOpen(true)}>＋ {t('new_transaction')}</Button>
              : undefined} />)}
          </Card>

          {data.commission?.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.commission.map((c: any) => (
                <Card key={c.currency} className="rule-primary px-4 py-3">
                  <div className="text-[11px] text-text-muted">★ {t('commission')} ({c.currency})</div>
                  <div className="mt-0.5 text-lg font-bold text-primary num">{amountDisplay(c.commission_minor)}</div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {createOpen && (
        <NewTransaction
          serviceCode={serviceCode}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); reload(); txns.reload(); }}
        />
      )}
    </div>
  );
}

function Row({ label, dir, children }: { label: string; dir?: 'in' | 'out'; children: React.ReactNode }) {
  return (
    <div className={cls('flex items-center justify-between gap-2')}>
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        {dir && <DirectionMark direction={dir} className="h-4 w-4 text-[10px]" />}
        {label}
      </span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}
