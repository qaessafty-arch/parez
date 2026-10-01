import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { Card, EmptyState, Input, PageHeader, Spinner, useLoad } from '../ui/kit';

const KIND_KEY: Record<string, TKey> = {
  customer: 'kind_customer',
  transaction: 'kind_transaction',
  receipt: 'kind_receipt',
  ronaki_contract: 'kind_ronaki_contract',
  wallet_account: 'kind_wallet_account',
  expense: 'kind_expense',
};

const KIND_LINK: Record<string, string> = {
  customer: '/customers',
  transaction: '/transactions',
  receipt: '/receipts',
  ronaki_contract: '/ronaki',
  wallet_account: '/fastpay',
  expense: '/expenses',
};

export default function SearchPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    const id = setTimeout(() => {
      setParams(q ? { q } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [q, setParams]);

  const { data, loading } = useLoad(
    () => (q.trim().length >= 1 ? api<any>(`/api/search?q=${encodeURIComponent(q.trim())}&limit=20`) : Promise.resolve(null)),
    [q]
  );

  return (
    <div>
      <PageHeader title={t('nav_search')} />
      <Card className="mb-4 p-3">
        <Input autoFocus placeholder={t('search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>

      {loading && <Spinner />}
      {data && (data.results.length === 0 ? <EmptyState /> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {data.results.map((r: any, i: number) => (
              <li key={`${r.kind}-${r.id}-${i}`}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface"
                  onClick={() => nav(KIND_LINK[r.kind] ?? '/')}
                >
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">
                    {t(KIND_KEY[r.kind] ?? 'kind_transaction')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-primary">{r.title}</span>
                    <span className="block truncate text-xs text-text-muted">{r.subtitle}</span>
                  </span>
                  <span className="text-text-muted">→</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
