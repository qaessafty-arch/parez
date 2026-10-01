import { useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls, todayISO } from '../lib/format';
import { Button, Card, EmptyState, PageHeader, Spinner, useLoad } from '../ui/kit';
import { useSession } from '../App';

const TYPE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'nav_transactions', types: ['daily', 'weekly', 'monthly', 'custom', 'transactions'] },
  { label: 'nav_fastpay', types: ['fastpay', 'nasswallet'] },
  { label: 'nav_reports', types: ['commission', 'expense', 'cash_flow', 'ronaki', 'customer_debt'] },
];

export default function Reports() {
  const { t } = useI18n();
  const { master } = useSession();
  const [type, setType] = useState('daily');
  const [range, setRange] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [currency, setCurrency] = useState('');
  const [serviceCode, setServiceCode] = useState('');
  const [ran, setRan] = useState(false);

  const qs = (() => {
    const p = new URLSearchParams();
    if (range === 'custom') { p.set('from', from); p.set('to', to); }
    else if (type !== 'daily' && type !== 'weekly' && type !== 'monthly') p.set('range', range);
    if (currency) p.set('currency', currency);
    if (serviceCode) p.set('service_code', serviceCode);
    return p.toString();
  })();

  const { data, loading, error } = useLoad(
    () => (ran ? api<any>(`/api/reports/${type}?${qs}`) : Promise.resolve(null)),
    [type, qs, ran]
  );

  const rangeFree = type === 'customer_debt';

  return (
    <div>
      <PageHeader title={t('nav_reports')} />

      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap gap-4">
          {TYPE_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-[11px] font-bold text-text-secondary">{t(g.label as never)}</div>
              <div className="flex flex-wrap gap-1">
                {g.types.map((ty) => (
                  <button
                    key={ty}
                    onClick={() => { setType(ty); setRan(false); }}
                    className={cls('rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                      type === ty ? 'bg-primary text-white shadow' : 'bg-surface-2 text-text-secondary hover:bg-slate-200')}
                  >
                    {t(reportLabel(ty) as never)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!rangeFree && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-color/[.08] pt-3">
            <select value={range} onChange={(e) => setRange(e.target.value as any)} className="rounded-lg border border-border-color/[.15] px-2.5 py-1.5 text-sm">
              <option value="today">{t('today')}</option>
              <option value="yesterday">{t('yesterday')}</option>
              <option value="week">{t('week')}</option>
              <option value="month">{t('month')}</option>
              <option value="custom">{t('custom')}</option>
            </select>
            {range === 'custom' && (
              <>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border-color/[.15] px-2 py-1.5 text-sm" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border-color/[.15] px-2 py-1.5 text-sm" />
              </>
            )}
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="rounded-lg border border-border-color/[.15] px-2.5 py-1.5 text-sm">
              <option value="">{t('currency')}: {t('all')}</option>
              {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
            <select value={serviceCode} onChange={(e) => setServiceCode(e.target.value)} className="rounded-lg border border-border-color/[.15] px-2.5 py-1.5 text-sm">
              <option value="">{t('service')}: {t('all')}</option>
              {master.services.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <Button onClick={() => setRan(true)}>▶ {t('run_report')}</Button>
            {ran && (
              <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/${type}?format=csv&${qs}`)}>
                ⬇ {t('export_csv')}
              </Button>
            )}
          </div>
        )}
        {rangeFree && !ran && <div className="border-t border-border-color/[.08] pt-3"><Button onClick={() => setRan(true)}>▶ {t('run_report')}</Button></div>}
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && <Spinner />}

      {data && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-color/[.08] px-4 py-3">
            <div>
              <div className="text-sm font-bold text-text-primary">{data.title}</div>
              <div className="text-[11px] text-text-secondary">
                {data.range && !data.range_ignored ? `${data.range.from} → ${data.range.to}` : ''} · {t('generated')} {String(data.generated_at).slice(0, 16).replace('T', ' ')}
              </div>
            </div>
            <div className="text-xs text-text-secondary num">{data.count} ×</div>
          </div>

          {data.rows?.length ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="sticky top-0 bg-surface text-[11px] text-text-secondary">
                  <tr>{data.columns.map((c: any) => <th key={c.key} className="px-3 py-2.5 text-start font-semibold">{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-surface">
                      {data.columns.map((c: any) => (
                        <td key={c.key} className={cls('px-3 py-2 text-xs text-text-secondary',
                          /amount|commission|total|paid|remaining|outstanding|credit|opening|cash|net|volume|diff/i.test(c.key) && 'num')}>
                          {r[c.key] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState />}

          {data.totals?.length > 0 && (
            <div className="border-t border-border-color/[.10] bg-surface px-4 py-3">
              <div className="mb-1.5 text-[11px] font-bold text-text-secondary">{t('totals')}</div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {data.totals.map((row: any, i: number) => (
                  <span key={i} className="num font-semibold text-text-primary">
                    {Object.entries(row).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                  </span>
                ))}
              </div>
            </div>
          )}
          {data.note && <div className="px-4 py-2 text-xs italic text-text-secondary">{data.note}</div>}
        </Card>
      )}
    </div>
  );
}

function reportLabel(type: string): string {
  const map: Record<string, string> = {
    daily: 'daily', weekly: 'weekly', monthly: 'monthly', custom: 'custom', transactions: 'report_transactions',
    fastpay: 'nav_fastpay', nasswallet: 'nav_nasswallet', commission: 'report_commission',
    expense: 'report_expense', cash_flow: 'report_cash_flow', ronaki: 'nav_ronaki', customer_debt: 'report_debt',
  };
  return map[type] ?? type;
}
