import { useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { todayISO } from '../lib/format';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Table, Td, useLoad } from '../ui/kit';

export default function Audit() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ from: '', to: '', action: '', entity: '', search: '' });
  const [limit] = useState(100);
  const [offset, setOffset] = useState(0);

  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);

  const { data, loading, error } = useLoad(() => api<any>(`/api/audit?${qs}`), [qs.toString()]);
  const actions = useLoad(() => api<any>('/api/audit/actions'), []);

  const setF = (k: keyof typeof filters) => (e: React.ChangeEvent<any>) => setFilters((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <PageHeader title={t('nav_audit')} subtitle={data ? String(data.total) : ''}>
        <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/reports/transactions?format=csv&from=${filters.from || '2000-01-01'}&to=${filters.to || '2099-12-31'}`)}>
          ⬇ {t('export_csv')}
        </Button>
      </PageHeader>

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Input type="date" value={filters.from} onChange={setF('from')} aria-label={t('from')} />
          <Input type="date" value={filters.to} onChange={setF('to')} aria-label={t('to')} />
          <select value={filters.action} onChange={setF('action')} className="rounded-lg border border-border-color px-2 py-2 text-sm">
            <option value="">{t('action')}: {t('all')}</option>
            {actions.data?.actions?.map((a: string) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Input placeholder={t('search') + '…'} value={filters.search} onChange={setF('search')} />
          <Button variant="ghost" size="sm" onClick={() => setFilters({ from: '', to: '', action: '', entity: '', search: '' })}>{t('clear')}</Button>
        </div>
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('date'), t('action'), t('entity'), t('created_by'), t('reason'), t('old_value'), t('new_value'), t('ip')]}>
              {data.rows.map((a: any) => (
                <tr key={a.id} className="hover:bg-surface align-top">
                  <Td className="num text-xs whitespace-nowrap">{String(a.created_at).slice(0, 16).replace('T', ' ')}</Td>
                  <Td><Badge kind={a.action.includes('DELETE') || a.action.includes('REVERSE') ? 'err' : a.action.includes('CREATE') ? 'ok' : 'blue'}>{a.action}</Badge></Td>
                  <Td className="text-xs">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</Td>
                  <Td className="text-xs">{a.user_name || '—'}</Td>
                  <Td className="text-xs max-w-40">{a.reason || '—'}</Td>
                  <Td className="text-[11px] text-text-secondary max-w-40 break-all">{fmtVal(a.old_value)}</Td>
                  <Td className="text-[11px] max-w-40 break-all">{fmtVal(a.new_value)}</Td>
                  <Td className="num text-[11px] text-text-secondary">{a.ip || '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex items-center justify-between px-4 py-3 text-xs text-text-secondary">
            <span>{offset + 1}–{Math.min(offset + limit, data.total)} / {data.total}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>←</Button>
              <Button variant="outline" size="sm" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>→</Button>
            </div>
          </div>
        </Card>
      )}
      <div className="mt-2 text-[11px] text-text-secondary num">{todayISO()}</div>
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
