const whole = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const formatNumber = (n: number) => whole.format(Math.round(n));
export const formatCompact = (n: number) => compact.format(n);
export const formatCurrency = (n: number) => usd.format(n);
export const formatPercent = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
export const formatDelta = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-22" -> "22 Oct" (no Date parsing, so server and browser always agree). */
export function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
