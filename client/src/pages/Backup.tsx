import { useState } from 'react';
import { api, errText, downloadFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { fileSize } from '../lib/format';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td,
  useLoad, useToast,
} from '../ui/kit';

export default function Backup() {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [restore, setRestore] = useState<any | null>(null);
  const { data, loading, reload } = useLoad(() => api<any>('/api/backups'), []);

  const createBackup = async () => {
    setBusy(true);
    setError('');
    try {
      const b = await api<any>('/api/backups', { method: 'POST', body: { note: note || undefined } });
      toast('ok', b.file_name);
      setNote('');
      reload();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('nav_backup')} subtitle={data ? `${t('backup_file')}: ${data.backup_dir}` : ''}>
        <div className="flex gap-2">
          <Input placeholder={t('note')} value={note} onChange={(e) => setNote(e.target.value)} className="w-44" />
          <Button onClick={createBackup} disabled={busy}>💾 {busy ? t('loading') : t('backup_now')}</Button>
        </div>
      </PageHeader>

      {data?.needs_backup && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          ⚠ {t('needs_backup')}
        </div>
      )}
      {error && <div className="mb-3 rounded-lg bg-out-50 px-4 py-3 text-sm text-out-600">{error}</div>}
      {loading && !data && <Spinner />}

      {data && (
        <Card>
          <div className="flex items-center justify-between border-b border-border-color px-4 py-3 text-xs text-text-secondary">
            <span>
              {t('dash_last_backup')}:{' '}
              <b className="num">{data.last_backup_at ? String(data.last_backup_at).slice(0, 16).replace('T', ' ') : t('dash_never')}</b>
            </span>
            <span>{t('backup_warn_days')}: {data.warn_days}</span>
          </div>

          {data.backups.length === 0 ? <EmptyState /> : (
            <Table head={[t('backup_file'), t('size'), t('note'), t('created'), t('actions')]}>
              {data.backups.map((b: any) => (
                <tr key={b.id} className="hover:bg-surface">
                  <Td>
                    <div className="num text-xs font-semibold">{b.file_name}</div>
                    {!b.exists && <Badge kind="err">missing</Badge>}
                  </Td>
                  <Td className="text-xs num">{fileSize(b.size_bytes ?? 0)}</Td>
                  <Td className="text-xs">{b.note || '—'}</Td>
                  <Td className="num text-xs">{String(b.created_at).slice(0, 16).replace('T', ' ')}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" disabled={!b.exists} onClick={() => downloadFile(`/api/backups/${b.id}/download`)}>
                        ⬇ {t('download')}
                      </Button>
                      <Button size="sm" variant="danger" disabled={!b.exists} onClick={() => setRestore(b)}>
                        ⟲ {t('restore')}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {restore && <RestoreModal backup={restore} onClose={() => setRestore(null)} onDone={() => { setRestore(null); reload(); toast('ok', t('restore')); }} />}
    </div>
  );
}

function RestoreModal({ backup, onClose, onDone }: { backup: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = confirm.trim() === backup.file_name;

  return (
    <Modal open onClose={onClose} title={`${t('restore')} — ${backup.file_name}`}>
      <div className="mb-4 rounded-xl border border-out-500/30 bg-out-50 p-4 text-sm text-out-600">
        ⚠ <b>{t('restore')}</b> — {t('restore_warning')}
      </div>
      <div className="mb-3 text-xs text-text-secondary">
        {t('backup_file')}: <span className="num font-semibold">{backup.file_name}</span> · {fileSize(backup.size_bytes ?? 0)} · {String(backup.created_at).slice(0, 16).replace('T', ' ')}
      </div>
      <Field label={t('restore_type_confirm')} required>
        <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" autoFocus placeholder={backup.file_name} />
      </Field>
      {error && <div className="mt-3 rounded-lg bg-out-50 px-3 py-2 text-sm text-out-600">{error}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="danger" disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api(`/api/backups/${backup.id}/restore`, { method: 'POST', body: { confirm: backup.file_name } });
              onDone();
            } catch (e) { setError(errText(e)); }
            finally { setBusy(false); }
          }}
        >
          {busy ? t('loading') : t('confirm')}
        </Button>
      </div>
    </Modal>
  );
}
