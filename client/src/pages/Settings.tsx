import { useEffect, useState } from 'react';
import { api, errText } from '../lib/api';
import { useSession } from '../App';
import { useI18n, LANGS } from '../lib/i18n';
import {
  Badge, Button, Card, Field, Input, PageHeader, Spinner, Textarea, useLoad, useToast,
} from '../ui/kit';

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api<any>('/api/settings'), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwMsg, setPwMsg] = useState('');
  const { meta, reloadMaster } = useSession();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');
  const [devInfo, setDevInfo] = useState<any>(null);
  const [orphans, setOrphans] = useState<any>(null);

  // The dev panel is only ever reachable when the server exposes /api/dev,
  // which happens solely in development. In production the fetch 404s and
  // this section never renders.
  const devAvailable = Boolean(meta.devMode);

  useEffect(() => {
    if (!data) return;
    setF({
      'shop.name': data.shop.name ?? '',
      'shop.address': data.shop.address ?? '',
      'shop.phone': data.shop.phone ?? '',
      'receipt.footer': data.shop.receipt_footer ?? '',
      'receipt.prefix': data.shop.receipt_prefix ?? '',
      'default.currency': data.shop.default_currency ?? 'IQD',
      'default.language': data.shop.default_language ?? 'ku',
      'tax.rate': data.shop.tax_rate ?? '0',
      'backup.warn_days': String(data.settings['backup.warn_days'] ?? '3'),
      'commission.rules': data.shop.commission_rules ?? '[]',
    });
  }, [data]);

  const set = (k: string) => (e: React.ChangeEvent<any>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      await api('/api/settings', { method: 'PATCH', body: f });
      toast('ok', t('save'));
      if (f['default.language'] === 'ku' || f['default.language'] === 'ar' || f['default.language'] === 'en') {
        setLang(f['default.language'] as never);
      }
      reload();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const changePw = async () => {
    setPwMsg('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: pw });
      setPw({ current_password: '', new_password: '' });
      setPwMsg('✓');
      toast('ok', t('change_password'));
    } catch (e) { setPwMsg(errText(e)); }
  };


  const uploadLogo = async (file: File) => {
    setLogoBusy(true);
    setLogoMsg('');
    try {
      const buf = await file.arrayBuffer();
      await api('/api/branding/logo', { method: 'POST', body: buf });
      setLogoMsg(t('shop_logo_upload') + ' ✓');
      reloadMaster();
      location.reload();
    } catch (e) {
      setLogoMsg(errText(e));
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await api('/api/branding/logo', { method: 'DELETE' });
      setLogoMsg('');
      reloadMaster();
      location.reload();
    } catch (e) {
      setLogoMsg(errText(e));
    } finally {
      setLogoBusy(false);
    }
  };

  const loadDev = async () => {
    try {
      setDevInfo(await api('/api/dev/info'));
      setOrphans(await api('/api/dev/orphans'));
    } catch (e) {
      setLogoMsg(errText(e));
    }
  };

  if (loading && !data) return <Spinner />;

  return (
    <div>
      <PageHeader title={t('nav_settings')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-bold text-text-primary">{t('shop_name')}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('shop_name')} className="sm:col-span-2"><Input value={f['shop.name'] ?? ''} onChange={set('shop.name')} /></Field>
            <Field label={t('address')} className="sm:col-span-2"><Input value={f['shop.address'] ?? ''} onChange={set('shop.address')} /></Field>
            <Field label={t('phone')}><Input value={f['shop.phone'] ?? ''} onChange={set('shop.phone')} dir="ltr" /></Field>
            <Field label={t('default_currency')}>
              <select value={f['default.currency'] ?? 'IQD'} onChange={set('default.currency')} className="w-full rounded-lg border border-border-color/[.15] px-3 py-2 text-sm">
                <option value="IQD">IQD</option><option value="USD">USD</option>
              </select>
            </Field>
            <Field label={t('default_language')}>
              <select value={f['default.language'] ?? 'ku'} onChange={set('default.language')} className="w-full rounded-lg border border-border-color/[.15] px-3 py-2 text-sm">
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Field>
            <Field label={t('tax_rate')}><Input value={f['tax.rate'] ?? ''} onChange={set('tax.rate')} dir="ltr" /></Field>
            <Field label={t('backup_warn_days')}><Input value={f['backup.warn_days'] ?? ''} onChange={set('backup.warn_days')} dir="ltr" /></Field>
            <Field label={t('receipt_prefix')}><Input value={f['receipt.prefix'] ?? ''} onChange={set('receipt.prefix')} dir="ltr" /></Field>
            <Field label={t('receipt_footer')} className="sm:col-span-2"><Input value={f['receipt.footer'] ?? ''} onChange={set('receipt.footer')} /></Field>
            <Field label={t('commission_rules')} hint='[{"service_code":"fastpay","currency":"IQD","percent":1}]' className="sm:col-span-2">
              <Textarea rows={3} value={f['commission.rules'] ?? ''} onChange={set('commission.rules')} dir="ltr" className="font-mono text-xs" />
            </Field>
          </div>
          {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-bold text-text-primary">{t('change_password')}</h3>
            <div className="space-y-4">
              <Field label={t('current_password')} required>
                <Input type="password" value={pw.current_password} onChange={(e) => setPw((x) => ({ ...x, current_password: e.target.value }))} autoComplete="current-password" />
              </Field>
              <Field label={t('new_password')} required hint="6+">
                <Input type="password" value={pw.new_password} onChange={(e) => setPw((x) => ({ ...x, new_password: e.target.value }))} autoComplete="new-password" />
              </Field>
            </div>
            {pwMsg && <div className={`mt-2 text-sm ${pwMsg === '✓' ? 'text-in-600' : 'text-out-600'}`}>{pwMsg}</div>}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={changePw} disabled={!pw.current_password || pw.new_password.length < 6}>{t('save')}</Button>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold text-text-primary">{t('language')}</h3>
            <div className="flex gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${lang === l.code ? 'bg-primary text-white' : 'bg-muted text-text-secondary'}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-bold text-text-primary">{t('shop_logo')}</h3>
            <div className="flex items-center gap-4">
              {meta.shopLogo ? (
                <img
                  src={meta.shopLogo}
                  alt=""
                  className="h-16 w-16 rounded-lg border border-border-color bg-surface object-contain"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-2xl font-black text-text-muted">پ</div>
              )}
              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90">
                  {logoBusy ? t('loading') : t('shop_logo_upload')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={logoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                {meta.shopLogo && (
                  <Button variant="outline" size="sm" disabled={logoBusy} onClick={removeLogo}>
                    {t('shop_logo_remove')}
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-text-muted">{t('shop_logo_hint')}</p>
            {logoMsg && (
              <p className={`mt-2 text-xs font-medium ${logoMsg.includes('✓') ? 'text-success' : 'text-danger'}`}>
                {logoMsg}
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold text-text-primary">Demo data</h3>
            <p className="mb-3 text-xs text-text-muted">
              Adds clearly-marked demo customers/transactions (is_demo=1). Can be removed any time.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline" size="sm"
                onClick={async () => {
                  try { await api('/api/settings/demo/load', { method: 'POST' }); toast('ok', 'Demo data loaded'); reload(); }
                  catch (e) { toast('err', errText(e)); }
                }}
              >Load demo data</Button>
              <Button
                variant="danger" size="sm"
                onClick={async () => {
                  if (!confirm('Remove ALL demo data? Real data is untouched.')) return;
                  try { await api('/api/settings/demo/remove', { method: 'POST' }); toast('ok', 'Demo data removed'); reload(); }
                  catch (e) { toast('err', errText(e)); }
                }}
              >Remove demo data</Button>
            </div>
          </Card>

          {devAvailable && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-text-primary">{t('dev_panel')}</h3>
                <Badge kind="blue">dev</Badge>
              </div>
              {!devInfo ? (
                <Button variant="outline" size="sm" onClick={loadDev}>{t('dev_info')}</Button>
              ) : (
                <div className="space-y-2 text-xs">
                  <Row k="Node" v={devInfo.node} />
                  <Row k="Platform" v={devInfo.platform} />
                  <Row k="Uptime" v={`${devInfo.uptime_seconds}s`} />
                  <Row k="Memory" v={`${devInfo.memory_mb} MB`} />
                  <Row k="DB" v={devInfo.db_path} />
                  <div className="mt-3 border-t border-border-color pt-2">
                    <div className="mb-1 font-semibold">{t('dev_orphans')}</div>
                    {orphans?.ok ? (
                      <span className="text-success">✓ {t('dev_no_orphans')}</span>
                    ) : (
                      <ul className="text-danger">
                        {(orphans?.orphans ?? []).map((o: any) => (
                          <li key={o.table}>{o.table}.{o.column}: {o.count}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-border-color pt-2">
                    {Object.entries(devInfo.counts ?? {}).map(([k, v]) => (
                      <Badge key={k} kind="gray">{k}: {String(v)}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-secondary">{k}</span>
      <span className="truncate font-mono text-[11px]" dir="ltr">{v}</span>
    </div>
  );
}
