import { useState } from 'react';
import { api, errText } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cls } from '../lib/format';
import {
  Badge, Button, Card, Field, Input, Modal, PageHeader, Spinner, Table, Td, useLoad, useToast,
} from '../ui/kit';
import { useSession } from '../App';

export default function Users() {
  const { t } = useI18n();
  const { user: me } = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [pwUser, setPwUser] = useState<any | null>(null);
  const { data, loading, error, reload } = useLoad(() => api<any>('/api/users'), []);

  return (
    <div>
      <PageHeader title={t('nav_users')}>
        <Button onClick={() => setEdit('new')}>＋ {t('new_user')}</Button>
      </PageHeader>

      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          <Table head={[t('username'), t('name'), t('role'), t('status'), t('last_login'), t('actions')]}>
            {data.users.map((u: any) => (
              <tr key={u.id} className="hover:bg-surface">
                <Td className="num text-xs font-semibold">{u.username}{u.id === me.id && <span className="ms-1 text-[10px] text-primary">({t('role_admin')})</span>}</Td>
                <Td>{u.full_name}</Td>
                <Td><Badge kind={u.role_code === 'admin' ? 'blue' : 'gray'}>{u.role_code === 'admin' ? t('role_admin') : t('role_employee')}</Badge></Td>
                <Td><Badge kind={u.is_active ? 'ok' : 'err'}>{u.is_active ? t('active') : t('inactive')}</Badge></Td>
                <Td className="num text-xs text-text-muted">{u.last_login_at ? String(u.last_login_at).slice(0, 16).replace('T', ' ') : '—'}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEdit(u)}>{t('edit')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPwUser(u)}>🔑</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>

          {/* roles */}
          <div className="border-t border-border-color/[.08] p-4">
            <h3 className="mb-2 text-xs font-bold text-text-muted">{t('role')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.roles.map((r: any) => (
                <div key={r.id} className="rounded-lg bg-surface p-3">
                  <div className="text-sm font-bold text-text-primary">{r.name} <span className="text-xs font-normal text-text-muted">({r.code})</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(r.permissions ?? []).slice(0, 12).map((p: string) => (
                      <span key={p} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-text-muted ring-1 ring-ink-900/[.10]">{p}</span>
                    ))}
                    {(r.permissions ?? []).length > 12 && <span className="text-[10px] text-text-muted">+{(r.permissions as string[]).length - 12}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {edit && (
        <UserModal
          user={edit === 'new' ? null : edit}
          roles={data?.roles ?? []}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload(); toast('ok', t('save')); }}
        />
      )}
      {pwUser && <PasswordModal user={pwUser} onClose={() => setPwUser(null)} onDone={() => { setPwUser(null); toast('ok', t('change_password')); }} />}
    </div>
  );
}

function UserModal({ user, roles, onClose, onSaved }: { user: any; roles: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({
    username: user?.username ?? '', full_name: user?.full_name ?? '', password: '',
    role_code: user?.role_code ?? 'employee', is_active: user ? Boolean(user.is_active) : true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async () => {
    setError('');
    if (!user && f.password.length < 6) return setError(t('admin_password'));
    setBusy(true);
    try {
      if (user) {
        const body: any = { full_name: f.full_name, role_code: f.role_code, is_active: f.is_active ? 1 : 0 };
        if (f.password) body.password = f.password;
        await api(`/api/users/${user.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/users', { method: 'POST', body: f });
      }
      onSaved();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={user ? `${t('edit')} — ${user.username}` : t('new_user')}>
      <div className="space-y-4">
        <Field label={t('username')} required>
          <Input value={f.username} onChange={set('username')} disabled={Boolean(user)} dir="ltr" />
        </Field>
        <Field label={t('name')} required><Input value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label={t('password')} required={!user} hint={user ? t('optional') : undefined}>
          <Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label={t('role')} required>
          <select value={f.role_code} onChange={set('role_code')} className="w-full rounded-lg border border-border-color/[.15] px-3 py-2 text-sm">
            {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={f.is_active} onChange={set('is_active')} className="accent-primary" />
          {t('active')}
        </label>
      </div>
      {error && <div className="mt-4 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 border-t border-border-color/[.08] pt-4">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal open onClose={onClose} title={`${t('change_password')} — ${user.username}`}>
      <Field label={t('new_password')} required>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" />
      </Field>
      {error && <div className="mt-3 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button
          disabled={busy || pw.length < 6}
          onClick={async () => {
            setBusy(true);
            try { await api(`/api/users/${user.id}`, { method: 'PATCH', body: { password: pw } }); onDone(); }
            catch (e) { setError(errText(e)); }
            finally { setBusy(false); }
          }}
        >{t('save')}</Button>
      </div>
    </Modal>
  );
}

export const _cls = cls;
