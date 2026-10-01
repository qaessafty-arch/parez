/**
 * New transaction — the action performed dozens of times a day.
 * Two things matter here: it must be quick, and the operator must see
 * exactly what will hit the books before committing. The preview at the
 * bottom is not decoration — it is the last check against a mis-posted
 * amount, and it teaches the commission rules while they type.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, duplicatesOf, errText, type DuplicateInfo } from '../lib/api';
import { useDraft } from '../lib/draft';
import { useI18n } from '../lib/i18n';
import { amountDisplay, parseAmount, todayISO, cls } from '../lib/format';
import {
  Alert, Button, Field, Input, Modal, Money, MoneyInput, Select, Textarea,
} from './kit';
import { useSession } from '../App';

type Props = {
  onClose: () => void;
  onCreated: (txn: any) => void;
  serviceCode?: string;
  typeCode?: string;
};

export default function NewTransaction({ onClose, onCreated, serviceCode, typeCode }: Props) {
  const { t } = useI18n();
  const { master, meta } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dup, setDup] = useState<DuplicateInfo | null>(null);
  const [forceReason, setForceReason] = useState('');
  const [touched, setTouched] = useState(false);

  const svc = serviceCode ?? 'other';
  const accountForService = master!.accounts.find((a) => a.code === svc.toUpperCase())?.id;
  const cashAccount = master!.accounts.find((a) => a.code === 'CASH')?.id;

  const blank = {
    service_code: svc,
    type_code: typeCode ?? 'cash_in',
    account_id: String(serviceCode ? (accountForService ?? '') : (cashAccount ?? '')),
    counter_account_id: '',
    customer_id: '',
    amount: '',
    currency: meta?.defaultCurrency ?? 'IQD',
    commission: '',
    payment_method: 'cash',
    wallet_number: '',
    reference_no: '',
    description: '',
    biz_date: todayISO(),
    status: 'completed',
    receipt: true,
  };

  // A counted amount survives an accidental close. The key carries the
  // context so a wallet draft cannot resurface in the cash form.
  const draftKey = `txn.${svc}.${typeCode ?? 'any'}`;
  const draft = useDraft(draftKey, blank);
  const [f, setF] = useState(() => draft.restored ?? blank);

  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const update = (patch: Partial<typeof blank>) => setF((x) => {
    const next = { ...x, ...patch };
    draft.set(next);
    return next;
  });
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<any>) =>
    update({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } as any);

  const type = master.transaction_types.find((x) => x.code === f.type_code);
  const isAdjustment = f.type_code === 'adjustment';
  const needsCounter = f.type_code === 'transfer';
  const amountMinor = parseAmount(f.amount);
  const commissionMinor = parseAmount(f.commission) ?? 0;
  const amountInvalid = touched && (amountMinor === null || amountMinor <= 0);

  // Services own an account; picking a service should point at it automatically.
  useEffect(() => {
    const s = master.services.find((x) => x.code === f.service_code);
    const own = s?.account_id ?? master.accounts.find((a) => a.code === f.service_code.toUpperCase())?.id;
    if (own) update({ account_id: String(own) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.service_code, master]);

  const submit = async (force = false) => {
    setTouched(true);
    setError('');
    setDup(null);
    if (amountMinor === null || amountMinor <= 0) return;
    setBusy(true);
    try {
      const body: any = {
        service_code: f.service_code,
        type_code: f.type_code,
        account_id: Number(f.account_id),
        amount: f.amount.replace(/,/g, ''),
        currency: f.currency,
        payment_method: f.payment_method,
        biz_date: f.biz_date,
        status: f.status,
        receipt: f.receipt,
      };
      if (f.counter_account_id) body.counter_account_id = Number(f.counter_account_id);
      if (f.customer_id) body.customer_id = Number(f.customer_id);
      if (f.commission) body.commission = f.commission.replace(/,/g, '');
      if (f.wallet_number) body.wallet_number = f.wallet_number;
      if (f.reference_no) body.reference_no = f.reference_no;
      if (f.description) body.description = f.description;
      if (isAdjustment) body.direction = direction;
      if (force) { body.force = true; body.force_reason = forceReason.trim() || 'Confirmed by user'; }

      const res = await api<any>('/api/transactions', { method: 'POST', body });
      // Posted: the draft has done its job and must not come back.
      draft.clear();
      onCreated(res.transaction);
    } catch (e) {
      const d = duplicatesOf(e);
      if (d) { setDup(d); setBusy(false); return; }
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('new_transaction')}
      wide
      footer={
        <>
          <span className="me-auto flex items-center gap-2 text-xs text-text-secondary">
            {draft.saved && (
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {t('draft_saved')}
              </span>
            )}
            {amountMinor && amountMinor > 0 ? (
              <span className="num">{amountDisplay(amountMinor)} {f.currency}</span>
            ) : t('amount')}
          </span>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button size="lg" disabled={busy || amountInvalid} onClick={() => submit(false)}>
            {busy ? t('loading') : t('create')}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); submit(false); }}
      >
        {/* Amount leads: it is the number the customer says out loud. */}
        <div className="sm:col-span-2">
          <div className="rounded-xl border border-border-color bg-white p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Field label={t('amount')} required error={amountInvalid ? t('invalid_amount') : null} className="flex-1">
                <MoneyInput
                  value={f.amount}
                  onChange={set('amount')}
                  invalid={amountInvalid}
                  autoFocus
                  className="py-3 text-2xl"
                  placeholder="0"
                />
              </Field>
              <Field label={t('currency')} required className="sm:w-36">
                <Select value={f.currency} onChange={set('currency')} className="py-3">
                  {master.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label={`${t('commission')} — ${t('auto_commission')}`} className="sm:max-w-[14rem]">
                <MoneyInput value={f.commission} onChange={set('commission')} placeholder={t('auto_commission')} />
              </Field>
            </div>
          </div>
        </div>

        {isAdjustment && (
          <Field label={t('direction')} required>
            <Select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
              <option value="in">in (↓)</option>
              <option value="out">out (↑)</option>
            </Select>
          </Field>
        )}

        <Field label={t('account')} required>
          <Select value={f.account_id} onChange={set('account_id')}>
            {master.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </Select>
        </Field>

        {needsCounter && (
          <Field label={`${t('account')} →`} required>
            <Select value={f.counter_account_id} onChange={set('counter_account_id')}>
              <option value="">—</option>
              {master.accounts
                .filter((a) => String(a.id) !== f.account_id)
                .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}

        <Field label={t('customer')}>
          <CustomerPicker
            value={f.customer_id}
            onChange={(v) => update({ customer_id: v })}
          />
        </Field>

        <Field label={t('biz_date')} required>
          <Input type="date" value={f.biz_date} onChange={set('biz_date')} />
        </Field>

        <Field label={t('payment_method')}>
          <Select value={f.payment_method} onChange={set('payment_method')}>
            {master.payment_methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>

        <Field label={t('status')}>
          <Select value={f.status} onChange={set('status')}>
            <option value="completed">{t('status_completed')}</option>
            <option value="pending">{t('status_pending')}</option>
          </Select>
        </Field>

        <Field label={t('wallet_number')}>
          <Input value={f.wallet_number} onChange={set('wallet_number')} dir="ltr" inputMode="numeric" />
        </Field>

        <Field label={t('reference_no')}>
          <Input value={f.reference_no} onChange={set('reference_no')} dir="ltr" />
        </Field>

        <Field label={t('description')} className="sm:col-span-2">
          <Textarea value={f.description} onChange={set('description')} rows={2} />
        </Field>

        <label className="flex items-center gap-2 text-sm text-text-secondary sm:col-span-2">
          <input type="checkbox" checked={f.receipt} onChange={set('receipt')} className="h-4 w-4 accent-emerald-600" />
          {t('print')}
        </label>

        {draft.restored && (
          <div className="sm:col-span-2">
            <Alert tone="info" title={t('draft_recovered')}>
              <button
                type="button"
                className="mt-2 text-xs font-semibold underline"
                onClick={() => { draft.discard(); setF(blank); setTouched(false); }}
              >
                {t('discard_draft')}
              </button>
            </Alert>
          </div>
        )}

        <div className="sm:col-span-2">
          <LedgerPreview
            accountName={master.accounts.find((a) => a.id === Number(f.account_id))?.name ?? ''}
            counterName={master.accounts.find((a) => a.id === Number(f.counter_account_id))?.name ?? ''}
            amountMinor={amountMinor}
            commissionMinor={commissionMinor}
            currency={f.currency}
            typeCode={f.type_code}
            typeDirection={type?.direction ?? 'in'}
            direction={direction}
          />
        </div>

        {error && <div className="sm:col-span-2"><Alert tone="err" title={error} /></div>}

        {dup && (
          <div className="sm:col-span-2">
            <Alert tone="warn" title={t('duplicate_warning')}>
              <ul className="mt-1 space-y-0.5 text-xs">
                {dup.duplicates.map((d) => (
                  <li key={d.id} className="num">
                    {d.tx_number} · {d.biz_date} · {amountDisplay(d.amount_minor)} {d.currency}
                    {d.reference_no ? ` · ${d.reference_no}` : ''}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label={t('force_reason')} required className="min-w-[14rem] flex-1">
                  <Input value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
                </Field>
                <Button variant="danger" disabled={!forceReason.trim() || busy} onClick={() => submit(true)}>
                  {t('duplicate_force')}
                </Button>
              </div>
            </Alert>
          </div>
        )}

        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

/** Mirrors services/ledger.js so what is promised here is what gets posted. */
function LedgerPreview({
  accountName, counterName, amountMinor, commissionMinor, currency,
  typeCode, typeDirection, direction,
}: {
  accountName: string; counterName: string; amountMinor: number | null;
  commissionMinor: number; currency: string; typeCode: string;
  typeDirection: string; direction: 'in' | 'out';
}) {
  const { t } = useI18n();
  const eff: string = typeCode === 'adjustment' ? direction : typeDirection;

  const lines = useMemo(() => {
    if (!amountMinor || amountMinor <= 0) return [];
    if (eff === 'transfer') {
      if (!counterName) return [];
      return [
        { dir: 'in' as const, account: counterName, amount: amountMinor },
        { dir: 'out' as const, account: accountName, amount: amountMinor },
      ];
    }
    if (eff === 'in') return [{ dir: 'in' as const, account: accountName, amount: amountMinor }];
    if (eff === 'out') return [{ dir: 'out' as const, account: accountName, amount: Math.max(0, amountMinor - commissionMinor) }];
    return [];
  }, [amountMinor, commissionMinor, eff, accountName, counterName]);

  return (
    <div className="rounded-xl border border-border-color/10 bg-white">
      <div className="flex items-center gap-2 border-b border-border-color/10 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-text-secondary">{t('ledger_preview')}</span>
        <span className="ms-auto text-[11px] text-text-secondary">{t('will_post')}</span>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-3 text-sm text-text-secondary">{t('no_entries')}</p>
      ) : (
        <div className="divide-y divide-border-color/[.06]">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cls(
                'inline-flex h-6 w-6 items-center justify-center rounded text-[13px] font-bold',
                l.dir === 'in' ? 'bg-in-50 text-in-600' : 'bg-out-50 text-out-600'
              )} aria-hidden>{l.dir === 'in' ? '↓' : '↑'}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{l.account}</span>
              <Money minor={l.dir === 'in' ? l.amount : -l.amount} currency={currency} bold />
            </div>
          ))}
          {commissionMinor > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 text-[13px] text-text-secondary">
              <span className="ms-9 flex-1">{t('commission')}</span>
              <Money minor={commissionMinor} currency={currency} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- customer search ---------------- */

export function CustomerPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [opts, setOpts] = useState<Array<{ id: number; full_name: string; phone?: string; code: string }>>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      api<any>(`/api/customers?limit=8&q=${encodeURIComponent(q)}`)
        .then((r) => { setOpts(r.rows); setCursor(0); })
        .catch(() => setOpts([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  const pick = (o: { id: number; full_name: string; code: string }) => {
    const label = `${o.full_name} (${o.code})`;
    setPicked(label);
    setQ(label);
    onChange(String(o.id));
    setOpen(false);
  };

  const clear = () => { setPicked(''); setQ(''); onChange(''); setOpen(true); };

  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <Input
        value={open ? q : picked}
        onFocus={() => { setOpen(true); setQ(picked ? '' : q); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (!e.target.value && !picked) onChange(''); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, opts.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter' && opts[cursor]) { e.preventDefault(); pick(opts[cursor]); }
          if (e.key === 'Escape') { setOpen(false); setQ(picked); }
        }}
        placeholder={t('search') + '…'}
        autoComplete="off"
        className={picked && !open ? 'pe-9' : undefined}
      />
      {picked && !open && value && (
        <button
          type="button" onClick={clear} aria-label={t('clear')}
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >✕</button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-border-color/10 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-2 text-start text-xs text-text-secondary hover:bg-surface"
            onMouseDown={() => { onChange(''); setQ(''); setOpen(false); }}
          >
            — {t('optional')} —
          </button>
          {opts.map((o, i) => (
            <button
              key={o.id} type="button"
              onMouseDown={() => pick(o)}
              className={cls(
                'block w-full px-3 py-2 text-start text-sm hover:bg-surface',
                i === cursor && 'bg-primary/10'
              )}
            >
              {o.full_name} <span className="doc ms-1">{o.phone ?? o.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
