/**
 * Navigation model — one source of truth for the sidebar, the mobile
 * drawer and the command palette. Grouped by what the operator is
 * doing, not by database table.
 */
import type { ReactNode } from 'react';
import type { TKey } from '../lib/i18n';

export type NavItem = { to: string; key: TKey; perm?: string; icon: ReactNode; hint?: TKey };
export type NavGroup = { key: TKey; items: NavItem[] };

export function Icon(d: string, size = 17) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const NAV: NavGroup[] = [
  {
    key: 'group_daily',
    items: [
      { to: '/', key: 'nav_dashboard', perm: 'dashboard.view', icon: Icon('M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z') },
      { to: '/transactions', key: 'nav_transactions', perm: 'transaction.view', icon: Icon('M4 7h16M4 12h16M4 17h10') },
      { to: '/closing', key: 'nav_closing', perm: 'closing.view', icon: Icon('M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z') },
    ],
  },
  {
    key: 'group_money',
    items: [
      { to: '/fastpay', key: 'nav_fastpay', perm: 'transaction.view', icon: Icon('M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5') },
      { to: '/nasswallet', key: 'nav_nasswallet', perm: 'transaction.view', icon: Icon('M3 7h18v10H3V7zm3 3h.01M18 14h.01') },
      { to: '/ronaki', key: 'nav_ronaki', perm: 'ronaki.view', icon: Icon('M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6') },
      { to: '/expenses', key: 'nav_expenses', perm: 'expense.view', icon: Icon('M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6') },
      { to: '/income', key: 'nav_income', perm: 'report.view', icon: Icon('M3 17l6-6 4 4 8-8M14 7h7v7') },
    ],
  },
  {
    key: 'group_records',
    items: [
      { to: '/customers', key: 'nav_customers', perm: 'customer.view', icon: Icon('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87') },
      { to: '/receipts', key: 'nav_receipts', perm: 'receipt.print', icon: Icon('M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z') },
      { to: '/reports', key: 'nav_reports', perm: 'report.view', icon: Icon('M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-4l-3 4-3-4z') },
      { to: '/audit', key: 'nav_audit', perm: 'audit.view', icon: Icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z') },
    ],
  },
  {
    key: 'group_admin',
    items: [
      { to: '/users', key: 'nav_users', perm: 'user.manage', icon: Icon('M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm7-4a3 3 0 11-6 0 3 3 0 016 0z') },
      { to: '/settings', key: 'nav_settings', perm: 'settings.manage', icon: Icon('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z') },
      { to: '/backup', key: 'nav_backup', perm: 'backup.manage', icon: Icon('M4 7v10a2 2 0 002 2h12a2 2 0 002-2V7M2 5h20v4H2V5zm7 9h6') },
    ],
  },
];

/** The four actions a shop reaches for every day — also the mobile bar. */
export const QUICK: NavItem[] = [
  { to: '/transactions', key: 'new_transaction', perm: 'transaction.create', icon: Icon('M12 5v14M5 12h14', 20) },
  { to: '/fastpay', key: 'nav_fastpay', perm: 'transaction.view', icon: Icon('M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5') },
  { to: '/ronaki', key: 'nav_ronaki', perm: 'ronaki.view', icon: Icon('M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6') },
  { to: '/expenses', key: 'nav_expenses', perm: 'expense.view', icon: Icon('M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6') },
];
