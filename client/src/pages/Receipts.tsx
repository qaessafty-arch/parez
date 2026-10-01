import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { amountDisplay, cls } from '../lib/format';
import {
  Button, Card, EmptyState, Input, Modal, PageHeader, Spinner, Table, Td, useLoad, useToast,
} from '../ui/kit';

export default function Receipts() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // global search links here as /receipts?id=<receipt number>
  const deepId = params.get('id');
  if (deepId && deepId !== openId) {
    setOpenId(deepId);
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('id'); return p; }, { replace: true });
  }

  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  qs.set('limit', '100');

  const { data, loading, error } = useLoad(() => api<any>(`/api/receipts?${qs}`), [qs.toString()]);

  return (
    <div>
      <PageHeader title={t('nav_receipts')} subtitle={data ? String(data.total) : ''}>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
      </PageHeader>

      <Card className="mb-4 p-3">
        <Input placeholder={t('search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          {data.rows.length === 0 ? <EmptyState /> : (
            <Table head={[t('receipt_number'), t('txn_number'), t('date'), t('customer'), t('amount'), t('print_count'), t('actions')]}>
              {data.rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-surface">
                  <Td className="num font-semibold text-xs">{r.receipt_number}</Td>
                  <Td className="num text-xs">{r.tx_number}</Td>
                  <Td className="num text-xs">{String(r.created_at).slice(0, 10)}</Td>
                  <Td className="text-xs">{r.customer_name || '—'}</Td>
                  <Td className="font-bold num">{amountDisplay(r.total_minor)} {r.currency}</Td>
                  <Td><span className="num text-xs text-text-secondary">{r.print_count} ×</span></Td>
                  <Td>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(String(r.id))}>🖨 {t('print')}</Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {openId && <ReceiptView id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export function ReceiptView({ id, onClose }: { id: string; onClose?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data, loading } = useLoad(() => api<any>(`/api/receipts/${id}`), [id]);

  const print = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(`/api/receipts/${id}/print`, { method: 'POST' });
      window.print();
    } catch (e) {
      // receipt may already be printed as a preview — still allow printing
      setErr(errText(e));
      window.print();
    } finally {
      setBusy(false);
      toast('ok', t('print'));
    }
  };

  return (
    <Modal open onClose={onClose ?? (() => {})} title={data ? `${t('receipt_number')} ${data.receipt_number}` : t('nav_receipts')} wide>
      {loading && <Spinner />}
      {data && (
        <div className="print-area">
          <div className="mx-auto max-w-sm rounded-lg border border-dashed border-border-color/[.15] bg-white p-6 font-mono text-[13px] text-text-primary">
            <div className="text-center">
              <div className="text-lg font-bold">{data.snapshot.shop.name}</div>
              <div className="text-xs text-text-secondary">{data.snapshot.shop.address}</div>
              <div className="text-xs text-text-secondary num">{data.snapshot.shop.phone}</div>
              <div className="my-2 border-t border-dashed border-border-color/[.15]" />
              <div className="text-sm font-bold">{t('receipt_number')}: <span className="num">{data.receipt_number}</span></div>
            </div>

            <div className="my-2 border-t border-dashed border-border-color/[.15]" />
            <Row label={t('txn_number')} value={data.snapshot.transaction.tx_number} />
            <Row label={t('date')} value={`${data.snapshot.transaction.date_display ?? data.snapshot.transaction.date} ${data.snapshot.transaction.time}`} />
            <Row label={t('service')} value={`${data.snapshot.transaction.service} · ${data.snapshot.transaction.type}`} />
            {data.snapshot.customer && <Row label={t('customer')} value={`${data.snapshot.customer.name} ${data.snapshot.customer.phone ? '· ' + data.snapshot.customer.phone : ''}`} />}
            <Row label={t('payment_method')} value={data.snapshot.transaction.payment_method} />
            {data.snapshot.transaction.reference_no && <Row label={t('reference_no')} value={data.snapshot.transaction.reference_no} />}

            <div className="my-2 border-t border-dashed border-border-color/[.15]" />
            <div className="flex items-center justify-between py-1 text-base font-bold">
              <span>{t('amount')}</span>
              <span className="num">{amountDisplay(data.snapshot.transaction.amount_minor)} {data.snapshot.transaction.currency}</span>
            </div>
            {data.snapshot.transaction.commission_minor > 0 && (
              <div className="flex items-center justify-between py-0.5 text-xs text-text-secondary">
                <span>{t('commission')}</span>
                <span className="num">{amountDisplay(data.snapshot.transaction.commission_minor)} {data.snapshot.transaction.currency}</span>
              </div>
            )}

            {data.snapshot.remaining_balance?.map((rb: any) => (
              <div key={rb.contract_number} className="mt-2 rounded bg-surface p-2 text-xs">
                <div className="font-bold">{rb.contract_number}</div>
                <div className="flex justify-between num">
                  <span>{t('total_required')}: {amountDisplay(rb.total_minor)}</span>
                  <span>{t('paid')}: {amountDisplay(rb.paid_minor)}</span>
                </div>
                <div className="flex justify-between num font-bold text-emerald-600">
                  <span>{t('remaining')}</span>
                  <span>{amountDisplay(rb.remaining_minor)} {rb.currency}</span>
                </div>
              </div>
            ))}

            <div className="my-2 border-t border-dashed border-border-color/[.15]" />
            <div className="text-center text-xs">
              <div>{t('processed_by')}: {data.snapshot.processed_by}</div>
              <div className="mt-1 font-bold">{data.snapshot.shop.footer || t('shop_footer')}</div>
            </div>
          </div>

          <div className="no-print mt-4 flex justify-end gap-2">
            {onClose && <Button variant="outline" onClick={onClose}>{t('close')}</Button>}
            <Button variant="primary" disabled={busy} onClick={print}>🖨 {busy ? t('loading') : t('print')}</Button>
          </div>
        </div>
      )}
      {err && <div className="no-print mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{err}</div>}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-text-secondary">{label}</span>
      <span className="text-end font-semibold num">{value || '—'}</span>
    </div>
  );
}

export { downloadFile };
export const _cls = cls;
