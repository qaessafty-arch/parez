/**
 * Shared UI — one system for every screen.
 * Rules that hold everywhere: hairline borders instead of soft shadows,
 * sentence-case labels, tabular numerals, a single navy accent,
 * and motion only in response to an action.
 */
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { cls } from '../lib/format';
import { useI18n } from '../lib/i18n';

/* ============================ toasts ============================ */

type Toast = { id: number; kind: 'ok' | 'err'; text: string };
const ToastContext = createContext<(kind: 'ok' | 'err', text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const drop = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    timers.current[id] = setTimeout(() => drop(id), kind === 'err' ? 8000 : 5000);
  }, [drop]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 z-[100] flex flex-col gap-2 [dir=ltr]:right-4 [dir=rtl]:left-4 sm:max-w-sm"
        role="status"
        aria-live="polite"
      >
        {items.map((x) => (
          <button
            key={x.id}
            onClick={() => drop(x.id)}
            className={cls(
              'animate-rise pointer-events-auto flex w-full items-start gap-2.5 rounded-lg px-3.5 py-3 text-start text-sm shadow-lg',
              x.kind === 'ok' ? 'bg-success text-white' : 'bg-danger text-white'
            )}
          >
            <span aria-hidden className={cls('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
              x.kind === 'ok' ? 'bg-white/40' : 'bg-white/40')}>
              {x.kind === 'ok' ? '✓' : '!'}
            </span>
            <span className="font-medium leading-snug">{x.text}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ============================ surfaces ============================ */

export function Card({ children, className, flat }: { children: ReactNode; className?: string; flat?: boolean }) {
  return <div className={cls(flat ? 'rounded-lg border border-border-color bg-surface' : 'rounded-lg border border-border-color bg-surface shadow-sm', className)}>{children}</div>;
}

export function PageHeader({
  title, subtitle, children, count,
}: { title: string; subtitle?: string; children?: ReactNode; count?: number | string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-baseline gap-2 text-xl font-bold tracking-tight text-text-primary">
          {title}
          {count !== undefined && (
            <span className="num rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-text-secondary">{count}</span>
          )}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Filter/action bar above tables. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cls('flex items-center justify-center py-10', className)}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/** Loading placeholders that match the shape of the content they replace. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cls('skeleton h-4', className)} />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cls('h-4', j === 0 ? 'w-24' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-6 w-28" />
        </Card>
      ))}
    </div>
  );
}

/** An empty screen is an invitation to act, not a dead end. */
export function EmptyState({ text, action, icon = 'doc' }: { text?: string; action?: ReactNode; icon?: 'doc' | 'search' }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-text-muted/60">
        {icon === 'search'
          ? <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>
          : <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M7.5 9.5h9M7.5 13.5h5.5" /></>}
      </svg>
      <p className="max-w-xs text-sm text-text-secondary">{text ?? t('no_data')}</p>
      {action}
    </div>
  );
}

/** Inline banner: what happened, and what to do about it. */
export function Alert({
  tone = 'info', title, children, action,
}: { tone?: 'info' | 'warn' | 'err' | 'ok'; title: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    info: 'border-border-color bg-surface text-text-primary',
    warn: 'border-warning/30 bg-warning/10 text-warning',
    err: 'border-danger/30 bg-danger/10 text-danger',
    ok: 'border-success/30 bg-success/10 text-success',
  };
  const mark = { info: 'i', warn: '!', err: '!', ok: '✓' };
  return (
    <div className={cls('mb-4 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3', tones[tone])}>
      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-current/10 text-xs font-bold">
        {mark[tone]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ============================ controls ============================ */

type FieldProps = {
  label?: string; hint?: string; children: ReactNode; className?: string;
  required?: boolean; error?: string | null;
};
export function Field({ label, hint, children, className, required, error }: FieldProps) {
  return (
    <label className={cls('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-text-secondary">
          {label}
          {required && <span className="text-danger" aria-hidden>*</span>}
        </span>
      )}
      {children}
      {error
        ? <span className="mt-1 block text-xs font-medium text-danger">{error}</span>
        : hint && <span className="mt-1 block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-lg border border-border-input bg-muted px-3 py-2 text-sm text-text-primary outline-none transition ' +
  'placeholder:text-text-secondary/80 focus:border-primary focus:bg-surface focus:ring-[3px] focus:ring-primary/15 ' +
  'disabled:bg-muted/60 disabled:text-text-muted';

export function Input({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cls(inputBase, invalid && 'border-danger', className)} />;
}

/** Amount entry: big, right-aligned, digits only feel. */
export function MoneyInput({ invalid, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      inputMode="decimal"
      dir="ltr"
      aria-invalid={invalid || undefined}
      className={cls(inputBase, 'num py-2.5 text-end text-base font-semibold', invalid && 'border-danger', className)}
      placeholder="0"
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cls(
        inputBase,
        'cursor-pointer appearance-none bg-[length:16px] bg-no-repeat pe-8',
        className
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2355647e' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'left 0.6rem center',
        ...props.style,
      }}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cls(inputBase, 'min-h-20 resize-y', className)} />;
}

export function SearchInput({
  value, onChange, placeholder, onClear, className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; onClear?: () => void; className?: string }) {
  return (
    <div className={cls('relative', className)}>
      <svg
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted"
      >
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cls(inputBase, 'ps-9', value && onClear && 'pe-9')}
      />
      {value && onClear && (
        <button
          type="button" onClick={onClear} aria-label="clear"
          className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-muted hover:text-text-primary"
        >✕</button>
      )}
    </div>
  );
}

export function Button({
  variant = 'primary', size = 'md', className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'success' | 'danger' | 'outline' | 'ghost'; size?: 'sm' | 'md' | 'lg';
}) {
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary/90 active:bg-primary-dark',
    success: 'bg-success text-white hover:bg-success/90',
    danger: 'bg-danger text-white hover:bg-danger/90',
    outline: 'border border-border-color bg-surface text-text-primary hover:border-primary/40 hover:bg-muted',
    ghost: 'text-text-secondary hover:bg-muted hover:text-text-primary',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs gap-1', md: 'px-3.5 py-2 text-sm gap-1.5', lg: 'px-5 py-2.5 text-[15px] gap-2' };
  return (
    <button
      {...rest}
      className={cls(
        'inline-flex select-none items-center justify-center rounded-lg font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-45',
        sizes[size], variants[variant], className
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ kind, children }: { kind: 'ok' | 'warn' | 'err' | 'gray' | 'blue'; children: ReactNode }) {
  const kinds = {
    ok: 'bg-success/10 text-success ring-success/25',
    warn: 'bg-warning/10 text-warning ring-warning/25',
    err: 'bg-danger/10 text-danger ring-danger/25',
    gray: 'bg-muted text-text-secondary ring-border-color',
    blue: 'bg-info/10 text-info ring-info/25',
  };
  return (
    <span className={cls('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', kinds[kind])}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="num rounded border border-border-color bg-surface px-1 py-px font-sans text-[10px] font-semibold text-text-muted">
      {children}
    </kbd>
  );
}

/** Segmented control — one option chosen, all options visible. */
export function Segmented<T extends string>({
  value, onChange, options, size = 'md', className,
}: {
  value: T; onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <div className={cls('inline-flex items-center gap-0.5 rounded-lg border border-border-color bg-surface p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cls(
            'rounded-[6px] font-semibold transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-primary text-white' : 'text-text-secondary hover:bg-muted'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ============================ overlays ============================ */

function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
}

export function Modal({
  open, onClose, title, subtitle, children, footer, wide,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]), select, textarea, button:not([aria-label=close])'
    );
    first?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-[6vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cls(
          'animate-rise flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-border-color bg-surface shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-color px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-text-secondary">{subtitle}</p>}
          </div>
          <button
            onClick={onClose} aria-label="close"
            className="-me-1.5 rounded-md p-1.5 text-text-muted hover:bg-muted hover:text-text-primary"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border-color bg-muted px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmText, danger, busy,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string;
  body: ReactNode; confirmText?: string; danger?: boolean; busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open} onClose={onClose} title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => { onConfirm(); }}
          >
            {confirmText ?? t('confirm')}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-text-secondary">{body}</div>
    </Modal>
  );
}

/** Side panel — keeps the list behind it visible while a record is reviewed. */
export function Drawer({
  open, onClose, title, children, footer,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose);
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('button, [href], input, select, textarea');
    first?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/50 md:start-60" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 end-0 flex w-full max-w-xl flex-col border-s border-border-color bg-surface shadow-2xl md:start-60"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-color px-5 py-3.5">
          <h2 className="text-base font-bold text-text-primary">{title}</h2>
          <button onClick={onClose} aria-label="close" className="rounded-md p-1.5 text-text-muted hover:bg-muted hover:text-text-primary">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border-color bg-muted px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ============================ table ============================ */

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cls('overflow-x-auto', className)}>
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead className="sticky-head">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 text-start text-[12px] font-semibold text-text-secondary">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-color">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cls('px-3 py-2.5 align-middle text-text-primary', className)}>{children}</td>;
}

/** A table row that behaves like a button (keyboard included). */
export function Tr({
  children, onClick, className,
}: { children: ReactNode; onClick?: () => void; className?: string }) {
  if (!onClick) return <tr className={className}>{children}</tr>;
  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cls('cursor-pointer transition hover:bg-muted/50 focus:bg-muted/50 focus:outline-none', className)}
    >
      {children}
    </tr>
  );
}

/* ============================ money ============================ */

export function Money({
  minor, currency, className, bold, muted,
}: { minor: number | null | undefined; currency: string; className?: string; bold?: boolean; muted?: boolean }) {
  const value = minor === null || minor === undefined ? '—' : (() => {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    const major = Math.floor(abs / 100);
    const cents = abs % 100;
    const s = major.toLocaleString('en-US') + (cents === 0 ? '' : `.${String(cents).padStart(2, '0')}`);
    return `${sign}${s}`;
  })();
  return (
    <span className={cls('num whitespace-nowrap', bold && 'font-bold', muted && 'text-text-secondary', className)}>
      {value}
      <span className="ms-1 text-[0.8em] font-medium text-text-secondary">{currency}</span>
    </span>
  );
}

/** Direction read at a glance: a tinted mark instead of a bare arrow. */
export function DirectionMark({ direction, className }: { direction: string; className?: string }) {
  const map: Record<string, { glyph: string; cls: string }> = {
    in: { glyph: '↓', cls: 'bg-success/10 text-success' },
    out: { glyph: '↑', cls: 'bg-danger/10 text-danger' },
    transfer: { glyph: '⇄', cls: 'bg-muted text-text-secondary' },
  };
  const d = map[direction] ?? { glyph: '•', cls: 'bg-muted text-text-secondary' };
  return (
    <span aria-hidden title={direction}
      className={cls('inline-flex h-6 w-6 items-center justify-center rounded text-[13px] font-bold', d.cls, className)}>
      {d.glyph}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, 'ok' | 'warn' | 'err' | 'gray' | 'blue'> = {
    completed: 'ok', pending: 'warn', cancelled: 'err', reversed: 'gray',
    paid: 'ok', partially_paid: 'warn', unpaid: 'gray', overdue: 'err',
  };
  const label: Record<string, string> = {
    completed: 'status_completed', pending: 'status_pending', cancelled: 'status_cancelled', reversed: 'status_reversed',
    paid: 'status_paid', partially_paid: 'status_partially_paid', unpaid: 'status_unpaid', overdue: 'status_overdue',
  };
  const { t } = useI18n();
  const key = label[status];
  return <Badge kind={map[status] ?? 'gray'}>{key ? t(key as never) : status}</Badge>;
}

/* ============================ data loading ============================ */

export function useLoad<T>(
  loader: () => Promise<T>, deps: unknown[]
): { data: T | null; loading: boolean; refreshing: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const hasData = useRef(false);

  useEffect(() => {
    alive.current = true;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    loader()
      .then((d) => { if (!alive.current) return; hasData.current = true; setData(d); })
      .catch((e) => { if (alive.current) setError(e?.message ?? String(e)); })
      .finally(() => { if (alive.current) { setLoading(false); setRefreshing(false); } });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, refreshing, error, reload: () => setTick((x) => x + 1) };
}