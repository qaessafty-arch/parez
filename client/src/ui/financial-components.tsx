/** Financial UI components: StatCard, BalanceCard, StatusBadge, CurrencyAmount. */
import { cls } from "../lib/format";

/** StatCard — a compact financial summary card used on the dashboard. */
export function StatCard({
  title,
  value,
  subtitle,
  delta,
  deltaPositive,
  className,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  delta?: string;
  deltaPositive?: boolean;
  className?: string;
}) {
  const sign = deltaPositive !== false ? 1 : -1;
  const signRenderer = sign > 0 ? "+" : "-";

  return (
    <div
      className={cls(
        "bg-white rounded-lg border border-border-color p-4 shadow-sm hover:shadow-md transition-shadow",
        className,
      )}
    >
      <div className="flex justify-between items-start">
        <div>
          <p className="text-caption text-text-secondary">{title}</p>
          {subtitle && <p className="text-body font-medium text-text-primary">{subtitle}</p>}
        </div>
        <div className="self-end">
          {value !== undefined && (
            <p className="text-2xl font-bold text-text-primary">{formatAmount(value)}</p>
          )}
        </div>
      </div>

      {delta && (
        <p className="mt-2 text-sm">
          <span className={cls("text-success", deltaPositive !== false && "text-warning")}>
            {signRenderer} {delta}
          </span>
        </p>
      )}
    </div>
  );
}

/** BalanceCard — dedicated account/balance section (Cash, FastPay, NassWallet). */
export function BalanceCard({
  label,
  amount,
  subtitle,
  currency = "IQD",
  lastUpdated,
  className,
}: {
  label: string;
  amount: number | string;
  subtitle?: string;
  currency?: string;
  lastUpdated?: string;
  className?: string;
}) {
  return (
    <div className={cls("bg-white rounded-lg border border-border-color p-4 shadow-sm hover:shadow-md transition-shadow", className)}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-caption text-text-secondary">{label}</p>
          {subtitle && <p className="text-body font-medium text-text-primary">{subtitle}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-text-primary">
            {formatAmount(amount)} {currency}
          </p>
          {lastUpdated && (
            <p className="text-caption text-text-muted">{lastUpdated}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** StatusBadge — consistent status labels (Completed, Pending, Cancelled, etc.). */
export function StatusBadge({
  label,
  variant = "neutral", // "positive" | "warning" | "destructive" | "neutral"
  size = "sm", // "sm" | "lg"
  className,
}: {
  label: string;
  variant?: "positive" | "warning" | "destructive" | "neutral";
  size?: "sm" | "lg";
  className?: string;
}) {
  const variantStyles = {
    positive: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    neutral: "bg-muted text-text-secondary",
  };

  const sizeStyles = {
    sm: "px-2.5 py-0.5 text-xs font-medium",
    lg: "px-4 py-1.5 text-sm font-medium",
  };

  return (
    <span
      className={cls(
        `inline-flex items-center rounded-full ${variantStyles[variant] || variantStyles.neutral} ${sizeStyles[size]}`,
        className,
      )}
    >
      {label}
    </span>
  );
}

/** CurrencyAmount — formats numbers with thousand separators and currency code.
 *  Always shows the currency so the user never guesses IQD vs USD.
 */
export function CurrencyAmount(amount: number | string | null | undefined, currency = "IQD") {
  if (amount === null || amount === undefined || amount === "") return "-";

  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "-";

  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);

  return `${formatted} ${currency}`;
}

/* Helper used by components above */
function formatAmount(amount: number | string) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "-";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}