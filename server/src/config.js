/**
 * Configuration — environment-driven, no secrets in client code.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = <root>/server/src  ->  <root>
export const ROOT = path.resolve(__dirname, '..', '..');

function loadEnvFile() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile();

const DATA_DIR = process.env.PAREZ_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

export const config = {
  port: Number(process.env.PORT || 4177),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.PAREZ_DB_PATH || path.join(DATA_DIR, 'parez.db'),
  dataDir: DATA_DIR,
  backupDir: path.join(DATA_DIR, 'backups'),
  clientDist: path.join(ROOT, 'client', 'dist'),
  isProd: process.env.NODE_ENV === 'production',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  // Security
  cookieName: 'parez_session',
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  // Backup warning threshold (days)
  backupWarnDays: Number(process.env.BACKUP_WARN_DAYS || 3),
  // Dev account - off by default and never hardcoded, so nothing sensitive
  // lives in the repo or in the ZIP that goes to the client.
  devAccount: {
    enabled: process.env.NODE_ENV === 'development'
      && process.env.PAREZ_DEV_ACCOUNT === '1'
      && Boolean(process.env.PAREZ_DEV_USERNAME)
      && Boolean(process.env.PAREZ_DEV_PASSWORD),
    username: process.env.PAREZ_DEV_USERNAME || '',
    password: process.env.PAREZ_DEV_PASSWORD || '',
    fullName: process.env.PAREZ_DEV_FULLNAME || 'Developer',
  },
};
