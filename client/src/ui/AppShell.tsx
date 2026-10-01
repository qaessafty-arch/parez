/** Application shell: sidebar + topbar + content. Handles layout, language, theme. */
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n, LANGS, type Lang } from "../lib/i18n";
import { cls } from "../lib/format";
import { Button } from "./kit";
import { NAV, QUICK } from "./nav";
import { useSession } from "../App";

type Theme = "light" | "dark" | "system";

export default function AppShell() {
  const { t, lang, setLang } = useI18n();
  const { user, can } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("parez.theme") as Theme | null;
    return saved && ["light", "dark", "system"].includes(saved) ? saved : "system";
  });

  const setTheme = (th: Theme) => {
    setThemeState(th);
    localStorage.setItem("parez.theme", th);
  };

  useEffect(() => {
    const html = document.documentElement;
    const apply = () => {
      const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      html.classList.toggle("dark", isDark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const pref = localStorage.getItem("parez.lang") as Lang | null;
    if (pref && ["ku", "ar", "en"].includes(pref)) setLang(pref);
  }, []);

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) }))
    .filter((g) => g.items.length > 0);
  const quick = QUICK.filter((i) => !i.perm || can(i.perm));
  const active = (to: string) => (to === "/" ? location.pathname === "/" : location.pathname.startsWith(to));

  return (
    <div className="flex min-h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — sibling of main workspace, never contains page content */}
      <aside className={cls(
        "flex w-60 flex-shrink-0 flex-col border-e border-border-color bg-surface",
        /* mobile: fixed overlay. translate direction must follow writing
           direction — in RTL the panel sits at the start edge (right), so
           closing means sliding further right, not further left. */
        "max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:z-50 max-md:transition-transform max-md:duration-200",
        sidebarOpen
          ? "max-md:translate-x-0"
          : "max-md:ltr:-translate-x-full max-md:rtl:translate-x-full",
        /* desktop: plain flex child, no z-index, no transform */
        "md:static"
      )}>
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-border-color px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-lg font-black text-white">پ</div>
          <div>
            <div className="text-sm font-bold tracking-tight text-text-primary">PAREZ</div>
            <div className="text-[10px] font-medium text-text-muted">Payment & Accounting</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {groups.map((g) => (
            <div key={g.key} className="mb-4 last:mb-0">
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {t(g.key)}
              </div>
              {g.items.map((item) => (
                <button
                  key={item.to}
                  onClick={() => { navigate(item.to); setSidebarOpen(false); }}
                  className={cls(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition",
                    active(item.to)
                      ? "bg-primary/10 text-primary"
                      : "text-text-secondary hover:bg-muted hover:text-text-primary"
                  )}
                >
                  {item.icon}
                  <span className="truncate">{t(item.key)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-border-color px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {user?.full_name?.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text-primary">{user?.full_name}</div>
              <div className="truncate text-[10px] text-text-muted">{user?.role_name}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-border-color bg-surface/95 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-2 text-text-secondary hover:bg-muted md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="open menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="text-base font-bold text-text-primary">{pageTitle()}</h1>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate("/search")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
                </svg>
              </Button>

              <div className="flex items-center gap-0.5 rounded-full border border-border-color bg-surface p-0.5">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="radio"
                    aria-checked={lang === l.code}
                    onClick={() => setLang(l.code)}
                    className={cls(
                      "rounded-full px-2 py-0.5 text-[11px] font-bold transition-all",
                      lang === l.code ? "bg-primary text-white" : "text-text-muted hover:text-text-primary"
                    )}
                  >
                    {l.code === "ku" ? "KU" : l.code === "ar" ? "AR" : "EN"}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-0.5 rounded-full border border-border-color bg-surface p-0.5" role="radiogroup" aria-label="theme">
                {(["light", "dark", "system"] as const).map((th) => (
                  <button
                    key={th}
                    type="button"
                    role="radio"
                    aria-checked={theme === th}
                    onClick={() => setTheme(th)}
                    className={cls(
                      "rounded-full px-2 py-0.5 text-[11px] font-bold transition-all",
                      theme === th ? "bg-primary text-white" : "text-text-muted hover:text-text-primary"
                    )}
                  >
                    {th === "light" ? "☀" : th === "dark" ? "☾" : "◐"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="sticky bottom-0 z-30 flex items-stretch gap-1 border-t border-border-color bg-surface/95 px-2 py-1.5 backdrop-blur md:hidden">
          {quick.map((i) => (
            <button
              key={i.to}
              onClick={() => navigate(i.to)}
              className={cls(
                "flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-semibold",
                active(i.to) ? "text-primary" : "text-text-muted"
              )}
            >
              {i.icon}
              <span className="max-w-full truncate">{t(i.key)}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function pageTitle(): string {
  const titles: Record<string, string> = {
    "/": "Dashboard",
    "/transactions": "Transactions",
    "/customers": "Customers",
    "/ronaki": "Ronaki Project",
    "/expenses": "Expenses",
    "/reports": "Reports",
    "/receipts": "Receipts",
    "/closing": "Daily Closing",
    "/settings": "Settings",
    "/users": "Users",
  };
  return titles[location.pathname] || "Parez";
}