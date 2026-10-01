/** Fetch wrapper: JSON, session cookies, CSRF header, typed errors, offline detection, retry. */

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Opts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;         // ms ceiling per attempt; default 20000
  retry?: number;           // max retries, GET only; default 2
  retryDelay?: number;      // ms between retries; default 1200
};

/* ---------- connectivity ---------- */

type ConnListener = (online: boolean) => void;
const connListeners = new Set<ConnListener>();
let _online = navigator.onLine;

export function onConnChange(fn: ConnListener): () => void {
  connListeners.add(fn);
  return () => connListeners.delete(fn);
}
export function isOnline() { return _online; }

function setOnline(v: boolean) {
  if (_online === v) return;
  _online = v;
  connListeners.forEach((fn) => fn(v));
}
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

/* ---------- session expiry ---------- */

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();
export function onSessionExpired(fn: SessionListener): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

/* ---------- core fetch ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Aborts surface as DOMException; `signal.reason` is more reliable than the name. */
function isAbortError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) return e.name === 'AbortError' || e.name === 'TimeoutError';
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * A request that outlives this is not slow, it is gone. Without a ceiling a
 * dropped connection leaves a form spinning forever, which reads as a bug and
 * blocks the counter. The caller's signal still wins; this is the backstop.
 */
const DEFAULT_TIMEOUT = 20_000;

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { 'X-Requested-With': 'parez' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const maxRetries = method === 'GET' ? (opts.retry ?? 2) : 0;
  const retryDelay = opts.retryDelay ?? 1200;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelay * attempt);

    const timeout = AbortSignal.timeout(opts.timeout ?? DEFAULT_TIMEOUT);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeout])
      : timeout;

    try {
      const res = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal,
      });

      // Connection was successful — mark online
      setOnline(true);

      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      if (res.status === 204) return undefined as T;

      // Session expired — notify listeners once, then throw
      if (res.status === 401 && !path.includes('/auth/login')) {
        sessionListeners.forEach((fn) => fn());
        throw new ApiError(401, 'SESSION_EXPIRED', 'Session expired');
      }

      if (isJson) {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const err = data?.error ?? {};
          throw new ApiError(res.status, err.code || `HTTP_${res.status}`, err.message || res.statusText, err.details ?? null);
        }
        return data as T;
      }

      if (!res.ok) {
        throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText);
      }
      return (await res.text()) as unknown as T;
    } catch (e) {
      // The caller cancelled deliberately (unmount, newer search term). That is
      // not a failure and must not be reported as one.
      if (opts.signal?.aborted) throw e;

      // Our own ceiling fired. The connection is up but the server never
      // answered, so this is not an "offline" state and gets no retry.
      if (isAbortError(e) && !opts.signal?.aborted) {
        throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond');
      }

      lastError = e;
      // Network failure — mark offline, retry if allowed
      if (e instanceof TypeError && /fetch|network|abort/i.test(e.message)) {
        setOnline(false);
        if (attempt < maxRetries) continue;
        throw new ApiError(0, 'NETWORK_ERROR', 'Connection lost — check your network');
      }
      throw e;
    }
  }
  throw lastError;
}

/** Human message from any thrown value. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isDuplicate(e: unknown): e is ApiError {
  return e instanceof ApiError && e.code === 'DUPLICATE_SUSPECTED';
}

export type DuplicateInfo = {
  duplicates: Array<{ id: number; tx_number: string; amount_minor: number; currency: string; biz_date: string; reference_no?: string | null; status: string }>;
  hint?: string;
};

export function duplicatesOf(e: unknown): DuplicateInfo | null {
  if (isDuplicate(e)) return (e.details as DuplicateInfo) ?? null;
  return null;
}

/** Download a CSV/file from the API (browser handles auth cookie). */
export async function downloadFile(url: string, filename?: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'parez' } });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data?.error?.message || message;
    } catch { /* not json */ }
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(cd);
  const name = filename || (match ? match[1] : 'download');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
