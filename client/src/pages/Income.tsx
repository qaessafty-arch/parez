import { useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { amountDisplay, cls, todayISO } from '../lib/format';
import { Button, Card, EmptyState, PageHeader, Spinner, useLoad } from '../ui/kit';

const RANGES = ['today', 'yesterday', 'week', 'month', 'custom'] as const;
type Range = (typeof RANGES)[number];

export default function Income() {
  const { t } = useI18n();
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const qs = range === 'custom' ? `from=${from}&to=${to}` : `range=${range}`;
  const { data, loading, error } = useLoad(() => api<any>(`/api/income/summary?${qs}`), [qs]);
  const commission = useLoad(() => api<any>(`/api/reports/commission?${qs}`), [qs]);

  return (
    <div>
      <PageHeader title={t('nav_income')} subtitle={t('income_note')}>
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={cls('rounded-md px-2.5 py-1 text-xs font-semibold', range === r ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary')}>
              {t(r as never)}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex gap-1">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border-color/[.10] px-2 py-1.5 text-xs" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border-color/[.10] px-2 py-1.5 text-xs" />
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/commission?format=csv&${qs}`)}>⬇ {t('export_csv')}</Button>
      </PageHeader>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* commission per currency */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold text-text-primary">★ {t('commission')}</h3>
            {data.commission?.length ? (
              <TableLite
                head={[t('currency'), t('commission'), t('amount'), t('total')]}
                rows={data.commission.map((c: any) => [
                  <b>{c.currency}</b>,
                  <span className="text-emerald-600 font-bold num">{amountDisplay(c.commission_minor)}</span>,
                  <span className="num">{amountDisplay(c.volume_minor)}</span>,
                  <span className="num">{c.tx_count}</span>,
                ])}
              />
            ) : <EmptyState />}
          </Card>

          {/* by service */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('by_service')}</h3>
            {data.by_service?.length ? (
              <TableLite
                head={[t('service'), t('currency'), t('commission'), t('total')]}
                rows={data.by_service.map((b: any) => [
                  b.service_name,
                  b.currency,
                  <span className="text-emerald-600 font-bold num">{amountDisplay(b.commission_minor)}</span>,
                  <span className="num">{b.count}</span>,
                ])}
              />
            ) : <EmptyState />}
          </Card>

          {/* other income + fees */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('other_income')}</h3>
            {data.other_income?.length ? (
              <TableLite
                head={[t('currency'), t('amount'), t('total')]}
                rows={data.other_income.map((o: any) => [
                  <b>{o.currency}</b>,
                  <span className="text-in-600 font-bold num">{amountDisplay(o.income_minor)}</span>,
                  <span className="num">{o.count}</span>,
                ])}
              />
            ) : <EmptyState />}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('fees')}</h3>
            {data.fees?.length ? (
              <TableLite
                head={[t('currency'), t('amount')]}
                rows={data.fees.map((f: any) => [
                  <b>{f.currency}</b>,
                  <span className="font-bold num">{amountDisplay(f.fees_minor)}</span>,
                ])}
              />
            ) : <EmptyState />}
            <p className="mt-3 text-xs text-text-secondary">{t('income_note')}</p>
          </Card>

          {/* commission report rows */}
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between px-4 pt-4">
              <h3 className="text-sm font-bold text-text-primary">{t('report_commission')}</h3>
              <span className="text-xs text-text-secondary">{commission.data?.count ?? 0}</span>
            </div>
            {commission.loading ? <Spinner /> : (commission.data?.rows?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[11px] text-text-secondary">
                    <tr>{commission.data.columns.map((c: any) => <th key={c.key} className="px-3 py-2 text-start">{c.label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {commission.data.rows.map((r: any, i: number) => (
                      <tr key={i} className="hover:bg-surface">
                        {commission.data.columns.map((c: any) => (
                          <td key={c.key} className={cls('px-3 py-2 text-xs', c.key === 'commission' && 'font-bold text-emerald-600 num', c.key === 'amount' && 'num')}>
                            {r[c.key] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState />)}
          </Card>
        </div>
      )}
    </div>
  );
}

function TableLite({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-color/[.08] text-[11px] text-text-secondary">
          {head.map((h, i) => <th key={i} className="px-2 py-1.5 text-start">{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => <td key={j} className="px-2 py-2 text-text-secondary">{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
