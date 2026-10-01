import { useState } from 'react';
import { api, errText } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { amountDisplay, cls, todayISO } from '../lib/format';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, Money, MoneyInput, PageHeader,
  Spinner, Table, Td, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

export default function Closing() {
  const { t } = useI18n();
  const { can, user } = useSession();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [actual, setActual] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reopenFor, setReopenFor] = useState<string | null>(null);

  const { data, loading, reload } = useLoad(() => api<any>(`/api/closing/preview?date=${date}`), [date]);
  const history = useLoad(() => api<any>('/api/closing/history?limit=30'), []);

  const closeDay = async () => {
    setError('');
    setBusy(true);
    try {
      await api('/api/closing', { method: 'POST', body: { date, actual, note } });
      toast('ok', t('close_day'));
      setActual({}); setNote('');
      reload(); history.reload();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('closing_title')}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
      </PageHeader>

      {loading && !data && <Spinner />}
      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {/* expected vs actual */}
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary">
                {t('nav_closing')}
                {data.closed && <Badge kind="ok">{t('status_completed')}</Badge>}
              </h3>

              {data.closed ? (
                <Table head={[t('currency'), t('expected_cash'), t('actual_cash'), t('difference'), t('cash_in'), t('cash_out'), t('note')]}>
                  {data.closed.map((c: any) => (
                    <tr key={c.id}>
                      <Td className="font-bold">{c.currency}</Td>
                      <Td><Money minor={c.expected_cash_minor} currency={c.currency} /></Td>
                      <Td><Money minor={c.actual_cash_minor} currency={c.currency} bold /></Td>
                      <Td className={cls('font-bold num', c.difference_minor === 0 ? 'text-in-600' : 'text-out-600')}>
                        {amountDisplay(c.difference_minor)}
                      </Td>
                      <Td><Money minor={c.cash_in_minor} currency={c.currency} /></Td>
                      <Td><Money minor={c.cash_out_minor} currency={c.currency} /></Td>
                      <Td className="text-xs">{c.note || '—'}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <>
                  <div className="space-y-3">
                    {data.cash.map((c: any) => (
                      <div key={c.currency} className="grid grid-cols-2 items-end gap-3 rounded-xl bg-surface p-3 sm:grid-cols-5">
                        <div className="text-sm">
                          <div className="text-[11px] text-text-secondary">{t('currency')}</div>
                          <b>{c.currency}</b>
                        </div>
                        <div className="text-sm">
                          <div className="text-[11px] text-text-secondary">{t('opening')}</div>
                          <span className="num">{amountDisplay(c.opening_minor)}</span>
                        </div>
                        <div className="text-sm">
                          <div className="text-[11px] text-text-secondary">{t('cash_in')} / {t('cash_out')}</div>
                          <span className="num text-in-600">+{amountDisplay(c.cash_in_minor)}</span>{' '}
                          <span className="num text-out-500">−{amountDisplay(c.cash_out_minor)}</span>
                        </div>
                        <div className="text-sm">
                          <div className="text-[11px] text-text-secondary">{t('expected_cash')}</div>
                          <b className="num">{amountDisplay(c.expected_minor)}</b>
                        </div>
                        <Field label={t('actual_cash')} required={c.expected_minor !== 0}>
                          <MoneyInput
                            value={actual[c.currency] ?? ''}
                            onChange={(e) => setActual((x) => ({ ...x, [c.currency]: e.target.value }))}
                            placeholder={amountDisplay(c.expected_minor)}
                          />
                        </Field>
                      </div>
                    ))}
                    {data.cash.length === 0 && <EmptyState />}
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t('note')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                    <div className="flex items-end">
                      <Button
                        variant="success" className="w-full py-2.5" disabled={busy || !can('closing.perform')}
                        onClick={closeDay}
                      >
                        🔒 {t('close_day')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>

            {/* totals / expenses / ronaki */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MiniCard title={t('nav_transactions')} rows={data.totals.map((x: any) => ({
                cur: x.currency,
                lines: [`${x.tx_count} ×`, `↓ ${amountDisplay(x.inflow_minor)}`, `↑ ${amountDisplay(x.outflow_minor)}`, `★ ${amountDisplay(x.commission_minor)}`],
              }))} />
              <MiniCard title={t('nav_expenses')} rows={data.expenses.map((x: any) => ({
                cur: x.currency, lines: [`${x.count} ×`, `− ${amountDisplay(x.total_minor)}`],
              }))} />
              <MiniCard title={t('nav_ronaki')} rows={data.ronaki.map((x: any) => ({
                cur: x.currency, lines: [`${x.count} ×`, `+ ${amountDisplay(x.total_minor)}`],
              }))} />
            </div>

            {/* wallet closings */}
            {data.wallet_closings?.length > 0 && (
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-bold text-text-primary">{t('wallet_closing')}</h3>
                <Table head={[t('account'), t('opening'), t('closing')]}>
                  {data.wallet_closings.map((w: any) => (
                    <tr key={w.code}>
                      <Td>{w.name}</Td>
                      <Td><Money minor={w.opening_balance_minor} currency={w.currency} /></Td>
                      <Td className="font-bold"><Money minor={w.closing_balance_minor} currency={w.currency} /></Td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </div>

          {/* history */}
          <Card className="h-fit p-4">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('closed_days')}</h3>
            {history.loading && <Spinner />}
            {history.data?.days?.length ? (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto">
                {history.data.days.map((d: any) => (
                  <div key={d.date} className="rounded-lg border border-border-color/[.08] p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <b className="num text-sm">{d.date}</b>
                      {can('closing.reopen') && (
                        <Button variant="ghost" size="sm" onClick={() => setReopenFor(d.date)}>⟲ {t('reopen_day')}</Button>
                      )}
                    </div>
                    {d.rows.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs text-text-secondary">
                        <span><b>{r.currency}</b> · {amountDisplay(r.actual_cash_minor)} / {amountDisplay(r.expected_cash_minor)}</span>
                        <span className={cls('num font-bold', r.difference_minor === 0 ? 'text-in-600' : 'text-out-600')}>
                          {amountDisplay(r.difference_minor)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : <EmptyState text={t('no_closings_today')} />}
          </Card>
        </div>
      )}

      {reopenFor && (
        <ReopenModal
          date={reopenFor}
          onClose={() => setReopenFor(null)}
          onDone={() => { setReopenFor(null); reload(); history.reload(); toast('ok', t('reopen_day')); }}
        />
      )}
      <div className="mt-3 text-[11px] text-text-secondary">— {user.username} —</div>
    </div>
  );
}

function MiniCard({ title, rows }: { title: string; rows: Array<{ cur: string; lines: string[] }> }) {
  return (
    <Card className="p-4">
      <h4 className="mb-2 text-xs font-bold text-text-secondary">{title}</h4>
      {rows.length ? rows.map((r) => (
        <div key={r.cur} className="mb-1.5 text-sm">
          <b>{r.cur}</b>
          <div className="text-xs text-text-secondary num">{r.lines.join(' · ')}</div>
        </div>
      )) : <span className="text-xs text-text-secondary">—</span>}
    </Card>
  );
}

function ReopenModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal open onClose={onClose} title={`${t('reopen_day')} — ${date}`}>
      <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('restore_warning')}</div>
      <Field label={t('reopen_reason')} required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {error && <div className="mt-3 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="danger" disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try { await api('/api/closing/reopen', { method: 'POST', body: { date, reason: reason.trim() } }); onDone(); }
            catch (e) { setError(errText(e)); }
            finally { setBusy(false); }
          }}
        >{t('confirm')}</Button>
      </div>
    </Modal>
  );
}
