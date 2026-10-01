import { useState, useEffect } from 'react';
import { api, errText } from '../lib/api';
import { useI18n, LANGS, type Lang } from '../lib/i18n';
import { cls } from '../lib/format';
import { Button, Field, Input } from '../ui/kit';

export default function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> | void }) {
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/auth/login', { method: 'POST', body: { username, password } });
      await onLoggedIn();
    } catch (e2) {
      setError(errText(e2));
      setShake(true);
      setTimeout(() => setShake(false), 600);
    } finally {
      setBusy(false);
    }
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = setTimeout(() => setMounted(true), 80); return () => clearTimeout(id); }, []);

  return (
    <div className="flex min-h-full items-center justify-center bg-page p-4">
      <div className="absolute right-4 top-4 flex items-center rounded-full border border-border-color bg-surface p-0.5 shadow-sm" role="radiogroup" aria-label="language">
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            onClick={() => setLang(l.code as Lang)}
            className={cls(
              'rounded-full px-3 py-1 text-xs font-bold transition-all',
              lang === l.code ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {l.code === 'ku' ? 'KU' : l.code === 'ar' ? 'عر' : 'EN'}
          </button>
        ))}
      </div>

      <form
        onSubmit={submit}
        className={cls(
          'relative w-full max-w-sm rounded-xl border border-border-color bg-surface p-8 shadow-lg transition-all duration-500',
          mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
          shake ? 'animate-shake' : ''
        )}
      >
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className={cls(
            'flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-2xl font-black text-white shadow-md transition-transform duration-700',
            mounted ? 'scale-100 rotate-0' : 'scale-75 rotate-6'
          )}>
            پ
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-text-primary">{t('login_title')}</h1>
            <p className="mt-0.5 text-sm text-text-secondary">{t('app_name')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label={t('username')} required>
            <Input
              autoFocus required value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" dir="ltr"
              placeholder={t('username')}
            />
          </Field>
          <Field label={t('password')} required>
            <div className="relative">
              <Input
                required type={showPw ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pe-10"
                placeholder="••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary"
                tabIndex={-1}
                aria-label={showPw ? t('hide_password') : t('show_password')}
              >
                {showPw ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </Field>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={busy || !username || !password} className="mt-6 w-full py-3 text-base">
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              {t('loading')}
            </span>
          ) : t('login')}
        </Button>
      </form>
    </div>
  );
}