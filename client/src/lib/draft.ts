/**
 * Draft persistence.
 *
 * A transaction is an act of counting out money. The operator's hands and
 * attention are on the customer, not the screen, so an accidental close,
 * a refresh, or a dead battery must not cost them a counted amount.
 *
 * `useDraft` keeps the form's state in localStorage while it is dirty, offers
 * it back on the next open, and refuses a silent page close while work
 * exists. It is deliberately per-form and per-context: a FastPay draft and a
 * cash draft are different animals and must never be confused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'parez.draft.';

/** Read a stored draft. Returns null when absent, corrupt, or expired. */
function read<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (!parsed || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > maxAgeMs) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export type Draft<T> = {
  /** Fields from a previous session, if one was recovered. */
  restored: T | null;
  /** True while the form holds work that is neither saved to the server nor cleared. */
  dirty: boolean;
  /** True briefly after a draft is actually written, so the UI can say so. */
  saved: boolean;
  /** Call whenever the form's state changes. */
  set: (value: T) => void;
  /** Forget the draft. Call after a successful submit. */
  clear: () => void;
  /** Throw the recovered draft away and start empty. */
  discard: () => void;
};

export function useDraft<T extends object>(
  key: string,
  _initial: T,
  opts: { maxAgeMs?: number; enabled?: boolean } = {},
): Draft<T> {
  const { maxAgeMs = 7 * 24 * 3600 * 1000, enabled = true } = opts;

  const [recovered] = useState<T | null>(() => (enabled ? read<T>(key, maxAgeMs) : null));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const timer = useRef<number | undefined>(undefined);
  const [discarded, setDiscarded] = useState(false);
  const restored = discarded ? null : recovered;

  const set = useCallback(
    (value: T) => {
      setDirty(true);
      setSaved(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        try {
          localStorage.setItem(
            PREFIX + key,
            JSON.stringify({ at: Date.now(), data: value }),
          );
          setSaved(true);
        } catch {
          // Storage full or blocked (private mode): the form still works,
          // it just cannot be recovered. Never break the transaction for it.
        }
      }, 400);
    },
    [key],
  );

  const wipe = useCallback(() => {
    window.clearTimeout(timer.current);
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
    setDirty(false);
    setSaved(false);
  }, [key]);

  const clear = wipe;

  const discard = useCallback(() => {
    wipe();
    setDiscarded(true);
  }, [wipe]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Closing the tab with a counted-but-unposted amount in hand is the exact
  // failure this whole file exists to prevent.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return { restored, dirty, saved, set, clear, discard };
}

/** Forget a draft key without mounting a form. */
export function dropDraft(key: string): void {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}
