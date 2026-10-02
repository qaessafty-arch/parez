/** App shell: boot -> setup | login | sidebar SPA. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { useI18n, type Lang } from './lib/i18n';
import { EmptyState } from './ui/kit';
import AppShell from './ui/AppShell';

import Setup from './pages/Setup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Wallets from './pages/Wallets';
import Ronaki from './pages/Ronaki';
import Customers from './pages/Customers';
import Expenses from './pages/Expenses';
import Income from './pages/Income';
import Reports from './pages/Reports';
import Closing from './pages/Closing';
import Receipts from './pages/Receipts';
import Audit from './pages/Audit';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Backup from './pages/Backup';
import SearchPage from './pages/Search';

export type User = {
  id: number; username: string; full_name: string; role_code: string; role_name: string;
  permissions: string[]; is_active: number; last_login_at?: string | null;
};

export type Master = {
  services: Array<{ id: number; code: string; name: string; account_id?: number }>;
  transaction_types: Array<{ id: number; code: string; name: string; direction: string }>;
  accounts: Array<{ id: number; code: string; name: string; kind: string; currency: string; account_number?: string }>;
  currencies: Array<{ code: string; name: string; symbol: string; decimals: number }>;
  payment_methods: Array<{ code: string; name: string }>;
  expense_categories: Array<{ id: number; code: string; name: string }>;
  shop: Record<string, string>;
};

type Session = {
  user: User;
  master: Master;
  meta: { shopName: string; shopLogo: string; devMode?: boolean; defaultLanguage: Lang; defaultCurrency: string; backupWarnDays: number };
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
  reloadMaster: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export const useSession = (): Session => {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside provider');
  return s;
};

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useSession();
  if (!can(perm)) return <EmptyState text="Permission denied" />;
  return <>{children}</>;
}

type Boot =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'login' }
  | { phase: 'ready'; session: Session };

export default function App() {
  const { setLang } = useI18n();
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  const doBoot = async () => {
    try {
      const s = await api<{ needsSetup: boolean }>('/api/setup/status');
      if (s.needsSetup) return setBoot({ phase: 'setup' });
      try {
        const me = await api<{ user: User }>('/api/auth/me');
        const metaRaw = await api<Record<string, any>>('/api/meta');
        const master = await api<Master>('/api/master/master');
        const meta = {
          shopName: metaRaw.shopName ?? 'Parez',
          shopLogo: metaRaw.shopLogo ?? '',
          devMode: metaRaw.devMode ?? false,
          defaultLanguage: (metaRaw.defaultLanguage ?? 'en') as Lang,
          defaultCurrency: metaRaw.defaultCurrency ?? 'IQD',
          backupWarnDays: metaRaw.backupWarnDays ?? 3,
        };
        const session: Session = {
          user: me.user,
          master,
          meta,
          can: (perm) => me.user.permissions.includes('*') || me.user.permissions.includes(perm),
          logout: async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { } },
          reloadMaster: async () => { await api('/api/master/master'); },
        };
        setBoot({ phase: 'ready', session });
      } catch (e) {
        if (e instanceof Error && 'status' in e && (e as any).status === 401) {
          return setBoot({ phase: 'login' });
        }
        throw e;
      }
    } catch {
      setBoot({ phase: 'login' });
    }
  };

  useEffect(() => { doBoot(); }, []);

  useEffect(() => {
    const pref = localStorage.getItem("parez.lang") as Lang | null;
    if (pref && ["ku", "ar", "en"].includes(pref)) setLang(pref);
  }, []);

  if (boot.phase === 'loading') {
    return <div className="flex h-screen items-center justify-center text-text-muted">Loading…</div>;
  }

  if (boot.phase === 'setup') {
    return <Setup onDone={doBoot} />;
  }

  if (boot.phase === 'login') {
    return <Login onLoggedIn={doBoot} />;
  }

  return (
    <SessionContext.Provider value={boot.session}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
          <Route path="/transactions" element={<Guard perm="transaction.view"><Transactions /></Guard>} />
          <Route path="/fastpay" element={<Guard perm="transaction.view"><Wallets serviceCode="fastpay" /></Guard>} />
          <Route path="/nasswallet" element={<Guard perm="transaction.view"><Wallets serviceCode="nasswallet" /></Guard>} />
          <Route path="/ronaki" element={<Guard perm="ronaki.view"><Ronaki /></Guard>} />
          <Route path="/customers" element={<Guard perm="customer.view"><Customers /></Guard>} />
          <Route path="/expenses" element={<Guard perm="expense.view"><Expenses /></Guard>} />
          <Route path="/income" element={<Guard perm="report.view"><Income /></Guard>} />
          <Route path="/reports" element={<Guard perm="report.view"><Reports /></Guard>} />
          <Route path="/closing" element={<Guard perm="closing.view"><Closing /></Guard>} />
          <Route path="/receipts" element={<Guard perm="receipt.print"><Receipts /></Guard>} />
          <Route path="/audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
          <Route path="/users" element={<Guard perm="user.manage"><Users /></Guard>} />
          <Route path="/settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />
          <Route path="/backup" element={<Guard perm="backup.manage"><Backup /></Guard>} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="*" element={<EmptyState text="404" />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}