/**
 * Dashboard — the shop's cash book for the chosen day.
 * Answers: "What is happening with the shop's money today?"
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls, todayISO } from '../lib/format';
import {
  Alert, Button, Card, DirectionMark, EmptyState, Money, PageHeader, Segmented,
  Skeleton, StatusBadge, Table, Td, Tr, useLoad,
} from '../ui/kit';
import { useSession } from '../App';

const RANGES = ['today', 'yesterday', 'week', 'month', 'custom'] as const;
type Range = (typeof RANGES)[number];

export default function Dashboard() {
  const { t } = useI18n();
  const { meta, can } = useSession();
  const nav = useNavigate();
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const qs = range === 'custom' ? `from=${from}&to=${to}` : `range=${range}`;
  const { data, loading, refreshing, error, reload } = useLoad(() => api<any>(`/api/dashboard?${qs}`), [qs]);

  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => { if (data) setUpdatedAt(new Date()); }, [data]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reloadRef.current();
    };
    const id = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const lastBackup = data?.last_backup_at;
  const backupDue = data && (!lastBackup
    ? true
    : (Date.now() - new Date(lastBackup).getTime()) / 86_400_000 >= meta.backupWarnDays);

  const cur = meta.defaultCurrency;
  const cards = data?.cards;

  return (
    <div>
      <PageHeader
        title={t('nav_dashboard')}
        subtitle={data
          ? (data.range.label === 'custom' ? `${data.range.from} → ${data.range.to}` : t(range as never))
          : undefined}
      >
        <Segmented
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r, label: t(r as never) }))}
        />
        {range === 'custom' && (
          <div className="flex items-center gap-1">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border-color px-2 py-1.5 text-xs" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border-color px-2 py-1.5 text-xs" />
          </div>
        )}
        <Button variant="outline" size="sm" onClick={reload} disabled={refreshing}>
          ⟳ {t('refresh')}
        </Button>
        {updatedAt && (
          <span className="hidden text-[11px] text-text-muted sm:inline">
            {refreshing ? t('loading') : `${t('updated')} ${updatedAt.toLocaleTimeString()}`}
          </span>
        )}
      </PageHeader>

      {error && <Alert tone="err" title={error} />}

      {loading && !data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <Skeleton className="h-3 w-32" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          </Card>
          <Card className="p-5">
            <Skeleton className="h-3 w-24" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
            </div>
          </Card>
        </div>
      )}

      {data && cards && (
        <div className="space-y-4">
          {(backupDue || !data.closed_today) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!data.closed_today && (
                <Alert
                  tone="info"
                  title={t('day_open_note')}
                  action={<Button size="sm" variant="outline" onClick={() => nav('/closing')}>{t('close_day')} →</Button>}
                />
              )}
              {backupDue && (
                <Alert
                  tone="warn"
                  title={t('needs_backup')}
                  action={can('backup.manage') ? <Button size="sm" onClick={() => nav('/backup')}>{t('go')} →</Button> : undefined}
                />
              )}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between border-b border-border-color px-5 py-3">
                <h2 className="text-sm font-bold text-text-primary">{t('todays_statement')}</h2>
                <span className="text-xs text-text-muted">{data.range.label === 'custom' ? `${data.range.from} → ${data.range.to}` : t(range as never)}</span>
              </div>

              {(data.currency_breakdown ?? []).length === 0 ? (
                <EmptyState text={t('no_entries')} />
              ) : (
                <div className="divide-y divide-border-color">
                  {data.currency_breakdown.map((b: any) => (
                    <div key={b.currency} className="px-5 py-4">
                      <div className="mb-3 flex items-baseline justify-between">
                        <span className="text-[13px] font-semibold text-text-secondary">
                          {b.currency} <span className="num ms-1 text-xs font-normal text-text-muted">· {b.tx_count} ×</span>
                        </span>
                        <span className="text-[11px] text-text-muted">{t('net_movement')}</span>
                      </div>
                      <div className="space-y-0">
                        <Line label={t('cash_in')} value={b.inflow_minor} currency={b.currency} dir="in" />
                        <Line label={t('cash_out')} value={b.outflow_minor} currency={b.currency} dir="out" />
                        <Line label={t('commission')} value={b.commission_minor} currency={b.currency} tone="primary" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-border-color bg-muted px-5 py-4">
                <div className="mb-2.5 text-[13px] font-semibold text-text-secondary">{t('wallet_balances')}</div>
                <div className="space-y-0">
                  {(data.balances ?? [])
                    .filter((b: any) => b.kind === 'cash' || b.kind === 'wallet')
                    .map((b: any) => (
                      <div key={`${b.id}-${b.currency}`} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-text-primary">
                          {b.name} <span className="doc ms-1">{b.code}</span>
                        </span>
                        <Money minor={b.balance_minor} currency={b.currency} bold />
                      </div>
                    ))}
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-bold text-text-primary">{t('quick_actions')}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {can('transaction.create') && (
                    <>
                      <QuickAction label={t('new_transaction')} onClick={() => nav('/transactions?new=1')} />
                      <QuickAction label={t('new_expense')} onClick={() => nav('/expenses?new=1')} />
                      <QuickAction label={t('new_ronaki_payment')} onClick={() => nav('/ronaki?new=1')} />
                      <QuickAction label={t('close_day')} onClick={() => nav('/closing')} />
                    </>
                  )}
                  {!can('transaction.create') && <QuickAction label={t('nav_transactions')} onClick={() => nav('/transactions')} />}
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-bold text-text-primary">{t('needs_attention')}</h2>
                <ul className="space-y-2.5 text-sm">
                  <Attention
                    label={t('dash_outstanding')}
                    value={<Money minor={cards.outstanding_minor} currency={cur} />}
                    to="/customers"
                  />
                  <Attention
                    label={t('dash_ronaki_remaining')}
                    value={<Money minor={cards.ronaki_remaining_minor} currency={cur} />}
                    to="/ronaki"
                  />
                  <Attention
                    label={t('dash_last_backup')}
                    value={lastBackup ? String(lastBackup).slice(0, 10) : t('dash_never')}
                    to="/backup"
                    muted={!lastBackup}
                  />
                </ul>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold text-text-primary">{t('dash_trend')}</h2>
                <div className="flex gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-success" /> {t('cash_in')}</span>
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" /> {t('cash_out')}</span>
                </div>
              </div>
              <TrendChart rows={data.chart ?? []} currency={data.primary_currency ?? cur} />
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-bold text-text-primary">{t('dash_recent')}</h2>
              <ul className="space-y-0">
                {(data.recent ?? []).slice(0, 6).map((r: any) => (
                  <li key={r.id}>
                    <button
                      onClick={() => nav('/transactions?id=' + r.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-start transition hover:bg-muted/50"
                    >
                      <DirectionMark direction={r.direction} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text-primary">{r.customer_name || r.service_name}</span>
                        <span className="doc">{r.tx_number}</span>
                      </span>
                      <Money minor={r.amount_minor} currency={r.currency} bold className="text-[13px]" />
                    </button>
                  </li>
                ))}
                {!(data.recent ?? []).length && <EmptyState />}
              </ul>
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => nav('/transactions')}>
                {t('view_all')} →
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({
  label, value, currency, dir, tone,
}: { label: string; value: number; currency: string; dir?: 'in' | 'out'; tone?: 'primary' }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-border-color py-2 last:border-0">
      <span className="flex items-center gap-2 text-sm text-text-secondary">
        {dir && <DirectionMark direction={dir} className="h-5 w-5 text-[11px]" />}
        {label}
      </span>
      <Money
        minor={value}
        currency={currency}
        bold
        className={tone === 'primary' ? 'text-primary' : dir === 'in' ? 'text-success' : dir === 'out' ? 'text-danger' : undefined}
      />
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-border-color bg-surface px-3 py-2.5 text-start text-[13px] font-semibold text-text-primary transition hover:border-primary/40 hover:bg-muted"
    >
      {label}
    </button>
  );
}

function Attention({ label, value, to, muted }: { label: string; value: React.ReactNode; to: string; muted?: boolean }) {
  const nav = useNavigate();
  return (
    <li>
      <button onClick={() => nav(to)} className="flex w-full items-center justify-between gap-3 text-start">
        <span className="text-text-secondary">{label}</span>
        <span className={cls('text-sm', muted ? 'text-danger' : 'text-text-primary')}>{value}</span>
      </button>
    </li>
  );
}

function TrendChart({ rows, currency }: { rows: Array<{ date: string; inflow_minor: number; outflow_minor: number }>; currency: string }) {
  const { t } = useI18n();
  if (!rows.length) return <EmptyState />;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.inflow_minor, r.outflow_minor)));
  return (
    <div>
      <div className="flex h-44 items-end gap-2">
        {rows.map((r) => {
          const dateLabel = r.date.slice(5);
          return (
            <div key={r.date} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="relative flex h-36 w-full items-end justify-center gap-1 border-b border-border-color">
                <div
                  className="w-1/2 rounded-t-sm bg-success/85 transition-all group-hover:bg-success"
                  style={{ height: `${Math.max((r.inflow_minor / max) * 100, r.inflow_minor > 0 ? 2 : 0)}%` }}
                  title={`${t('cash_in')}: ${(r.inflow_minor / 100).toLocaleString('en-US')} ${currency}`}
                />
                <div
                  className="w-1/2 rounded-t-sm bg-danger/85 transition-all group-hover:bg-danger"
                  style={{ height: `${Math.max((r.outflow_minor / max) * 100, r.outflow_minor > 0 ? 2 : 0)}%` }}
                  title={`${t('cash_out')}: ${(r.outflow_minor / 100).toLocaleString('en-US')} ${currency}`}
                />
              </div>
              <span className="num text-[10px] text-text-muted">{dateLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RecentTable({ rows }: { rows: any[] }) {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <Table head={[t('txn_number'), t('date'), t('service'), t('customer'), t('amount'), t('status')]}>
      {rows.map((r) => (
        <Tr key={r.id} onClick={() => nav('/transactions?id=' + r.id)}>
          <Td className="doc">{r.tx_number}</Td>
          <Td className="num text-xs">{r.biz_date}</Td>
          <Td>{r.service_name} · {r.type_name}</Td>
          <Td>{r.customer_name || '—'}</Td>
          <Td><Money minor={r.amount_minor} currency={r.currency} bold /></Td>
          <Td><StatusBadge status={r.status} /></Td>
        </Tr>
      ))}
    </Table>
  );
}