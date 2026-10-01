/**
 * Command palette — one place to go anywhere or start anything.
 * Keyboard-first (Ctrl/Cmd+K), but fully usable with a mouse: a shop
 * owner on a phone can also reach every section from here.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, type TKey } from '../lib/i18n';
import { cls } from '../lib/format';
import { Kbd } from './kit';
import { useSession } from '../App';
import { NAV } from './nav';

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: ReactNode;
  run: () => void;
};

export default function CommandPalette({ open, onClose, onNew }: { open: boolean; onClose: () => void; onNew: () => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<any[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(''); setCursor(0); setHits([]); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  // Escape closes the palette (the dialog itself traps nothing else)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    let live = true;
    const id = setTimeout(() => {
      api<any>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (live) setHits(r.rows ?? r.results ?? []); })
        .catch(() => { if (live) setHits([]); });
    }, 180);
    return () => { live = false; clearTimeout(id); };
  }, [q, open]);

  const pages = useMemo<Item[]>(
    () =>
      NAV.flatMap((g) => g.items)
        .filter((i) => !i.perm || can(i.perm))
        .map((i) => ({
          id: `nav:${i.to}`,
          label: t(i.key as TKey),
          group: t('navigate_to'),
          icon: i.icon,
          run: () => { nav(i.to); onClose(); },
        })),
    [t, can, nav, onClose]
  );

  const actions = useMemo<Item[]>(() => {
    const list: Item[] = [];
    if (can('transaction.create')) {
      list.push({ id: 'act:txn', label: t('new_transaction'), group: t('new'), run: () => { onClose(); onNew(); } });
    }
    if (can('expense.create')) {
      list.push({ id: 'act:expense', label: t('new_expense'), group: t('new'), run: () => { nav('/expenses'); onClose(); } });
    }
    list.push({ id: 'act:closing', label: t('close_day'), group: t('new'), run: () => { nav('/closing'); onClose(); } });
    return list;
  }, [can, t, nav, onClose, onNew]);

  const results = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const all = [...actions, ...pages];
    if (!needle) return all.slice(0, 10);
    return all.filter((i) => i.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, actions, pages]);

  useEffect(() => { setCursor(0); }, [q, open]);

  if (!open) return null;

  const flat = [...results, ...hits.map((h, i) => hitToItem(h, i, t, nav, onClose))];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); flat[cursor]?.run(); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-surface/95 p-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={t('search_or_jump')} className="animate-rise w-full max-w-xl overflow-hidden rounded-xl border border-surface/10 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-surface/10 px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-secondary">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={q.length < 2 ? t('search_or_jump') : t('command_hint')}
            className="w-full bg-transparent py-3.5 text-sm text-text-primary outline-none placeholder:text-text-muted/60"
            autoComplete="off"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {flat.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">{t('no_results')}</p>
          )}
          {grouped(flat).map(([group, items]) => (
            <div key={group}>
              <div className="px-4 py-1.5 text-[11px] font-semibold text-text-secondary">{group}</div>
              {items.map((it) => {
                const idx = flat.indexOf(it);
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={it.run}
                    className={cls(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm',
                      idx === cursor ? 'bg-surface/20 text-text-primary' : 'text-text-muted hover:bg-surface/10'
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-text-muted">{it.icon ?? <Dot />}</span>
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="doc shrink-0">{it.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-surface/10 px-4 py-2 text-[11px] text-text-secondary">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> {t('navigate_to')}</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> {t('open')}</span>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-text-muted/50" />;
}

function grouped(items: Item[]): Array<[string, Item[]]> {
  const out: Array<[string, Item[]]> = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last[0] === it.group) last[1].push(it);
    else out.push([it.group, [it]]);
  }
  return out;
}

const KIND_LABEL: Record<string, TKey> = {
  customer: 'kind_customer',
  transaction: 'kind_transaction',
  receipt: 'kind_receipt',
  ronaki_contract: 'kind_ronaki_contract',
  wallet_account: 'kind_wallet_account',
  expense: 'kind_expense',
};

function hitToItem(h: any, i: number, t: (k: TKey) => string, nav: (to: string) => void, onClose: () => void): Item {
  return {
    id: `hit:${h.kind}:${h.id}:${i}`,
    label: h.title ?? '—',
    hint: h.subtitle ?? undefined,
    group: t(KIND_LABEL[h.kind] ?? 'nav_search'),
    icon: <Doc />,
    run: () => { onClose(); nav(h.link ?? '/'); },
  };
}

function Doc() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M7 3h7l5 5v13H7V3z" /><path d="M14 3v5h5" />
    </svg>
  );
}
