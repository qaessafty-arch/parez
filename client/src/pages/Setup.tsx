import { useState } from 'react';
import { api, errText } from '../lib/api';
import { useI18n, LANGS } from '../lib/i18n';
import { Button, Field, Input, Select, useToast } from '../ui/kit';

export default function Setup({ onDone }: { onDone: () => Promise<void> | void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({
    shop_name: '', address: '', phone: '', currency: 'IQD', language: 'ku',
    username: '', full_name: '', password: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (f.password.length < 6) return setError(t('admin_password'));
    setBusy(true);
    try {
      await api('/api/setup', {
        method: 'POST',
        body: {
          shop_name: f.shop_name, address: f.address, phone: f.phone,
          currency: f.currency, language: f.language,
          admin: { username: f.username, full_name: f.full_name, password: f.password },
        },
      });
      toast('ok', t('setup_title'));
      await onDone();
    } catch (e2) {
      setError(errText(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-ink-950 via-ink-900 to-ink-800 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/100 text-xl font-bold text-white">پ</div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">{t('setup_title')}</h1>
            <p className="text-sm text-text-muted">{t('setup_subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('shop_name')} required className="sm:col-span-2">
            <Input required minLength={2} value={f.shop_name} onChange={set('shop_name')} placeholder="Parez" />
          </Field>
          <Field label={t('address')}>
            <Input value={f.address} onChange={set('address')} placeholder="Akre, Kurdistan Region" />
          </Field>
          <Field label={t('phone')}>
            <Input value={f.phone} onChange={set('phone')} placeholder="0750…" />
          </Field>
          <Field label={t('default_currency')} required>
            <Select value={f.currency} onChange={set('currency')}>
              <option value="IQD">IQD — Iraqi Dinar</option>
              <option value="USD">USD — US Dollar</option>
            </Select>
          </Field>
          <Field label={t('default_language')} required>
            <Select value={f.language} onChange={set('language')}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </Field>

          <div className="sm:col-span-2 mt-2 border-t border-border-color/[.08] pt-4">
            <div className="mb-3 text-xs font-bold text-primary">{t('role_admin')}</div>
          </div>
          <Field label={t('admin_username')} required>
            <Input required minLength={3} value={f.username} onChange={set('username')} autoComplete="username" />
          </Field>
          <Field label={t('admin_full_name')} required>
            <Input required minLength={2} value={f.full_name} onChange={set('full_name')} />
          </Field>
          <Field label={t('admin_password')} required className="sm:col-span-2">
            <Input required type="password" minLength={6} value={f.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
        </div>

        {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}

        <Button type="submit" disabled={busy} className="mt-6 w-full py-2.5">
          {busy ? t('loading') : t('setup_run')}
        </Button>
      </form>
    </div>
  );
}
