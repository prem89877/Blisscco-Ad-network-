// Paise ka hisab INTEGER me (float nahi). Platform ki currency: USD, database me numeric(12,2).
// 1 dollar = 100 cents. Text "2500.50" seedha 250050 cents banta hai, beech me Number/float kabhi nahi.
// Server action aur browser form DONO yahi use karte hain, isliye dono ke niyam ek jaise rehte hain.

export type MoneyParse =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "format" | "too_large" };

/** Itne digit se zyada ka dollar hissa seedha "too_large" (10 crore se upar ki value kabhi valid nahi). */
const MAX_DOLLAR_DIGITS = 12;

/**
 * "2500", "2,500.50" -> cents. Sirf 2 decimal tak. Koi symbol, minus, plus, space ke beech, e-notation nahi.
 * Comma sirf hazaar ke group ke liye ("2,500"); "2,5,0,0" galat.
 */
export function parseMoneyCents(raw: string): MoneyParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, reason: "format" };
  const s = trimmed.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, reason: "format" };
  const dollars = m[1].replace(/^0+(?=\d)/, ""); // leading zeros hatao ("00012" -> "12")
  if (dollars.length > MAX_DOLLAR_DIGITS) return { ok: false, reason: "too_large" };
  const frac = (m[2] ?? "").padEnd(2, "0");
  return { ok: true, cents: Number(dollars) * 100 + Number(frac) };
}

/** Cents -> dollar number. Jo value 2 decimal ki hai, JSON me bilkul wahi decimal jati hai (2500.5 -> "2500.5"). */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/** Database ka number (numeric(12,2)) -> cents. Ghalat/NaN par null. */
export function dollarsToCents(n: number | null | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Dollar ko hamesha 2 decimal ke text me ("$2,500.50"), sirf dikhane ke liye. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
