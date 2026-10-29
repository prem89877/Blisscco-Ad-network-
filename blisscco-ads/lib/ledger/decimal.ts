// Paise ka EXACT hisab (koi float nahi). Ledger numeric(14,4) hai: 1 unit = 0.0001 USD, isliye paisa BigInt "units" me.
// "0.0020" -> 20n. Beech me Number kabhi nahi aata, isliye 0.1 + 0.2 jaisi galti hoti hi nahi.
// Pure module (database/env nahi): server aur tests dono yahi use karte hain. SQL ke private.ledger_append / ledger_record_serve ka TypeScript aaina.

export const MONEY_SCALE = 4;
const UNIT = 10_000n; // 1.0000 USD = 10_000 units
/** numeric(14,4): 10 digit dollar + 4 decimal => sabse bada 9_999_999_999.9999. */
export const MAX_UNITS = 99_999_999_999_999n;

export type MoneyParse = { ok: true; units: bigint } | { ok: false; reason: "empty" | "format" | "too_many_decimals" | "too_large" };

/**
 * Text -> units. Sirf plain decimal ("12", "0.0020", "-0.5"). Float-text (1e-3), "+", space, comma, NaN: sab galat.
 * 4 se zyada decimal KABHI chupchap round nahi hote: seedha "too_many_decimals" (SQL ka ledger_invalid_amount bhi yahi karta hai).
 */
export function parseMoney(raw: string): MoneyParse {
  if (typeof raw !== "string" || raw === "") return { ok: false, reason: "empty" };
  const m = /^(-?)(\d{1,16})(?:\.(\d{1,}))?$/.exec(raw);
  if (!m) return { ok: false, reason: "format" };
  const [, sign, whole, frac = ""] = m;
  if (frac.length > MONEY_SCALE) return { ok: false, reason: "too_many_decimals" };
  const units = BigInt(whole) * UNIT + BigInt(frac.padEnd(MONEY_SCALE, "0"));
  if (units > MAX_UNITS) return { ok: false, reason: "too_large" };
  return { ok: true, units: sign === "-" ? -units : units };
}

/** units -> hamesha 4 decimal ka text ("0.0020"), SQL numeric(14,4) jaisa. */
export function formatMoney(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(MONEY_SCALE, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

export const addMoney = (a: bigint, b: bigint): bigint => a + b;
export const negateMoney = (a: bigint): bigint => -a;

/**
 * Ek serve ki keemat = CPM / 1000, 4 decimal tak half-up round, kam se kam 0.0001.
 * SQL record_ad_serve: greatest(round(cpm / 1000.0, 4), 0.0001) ka exact aaina (cpm_usd numeric(8,4) hai).
 * (lib/ads/category-matching.chargedUnitCostUsd float wala pre-filter hai; tests dono ko milate hain.)
 */
export function serveChargeUnitsFromCpm(cpmUnits: bigint): bigint {
  if (cpmUnits <= 0n) throw new RangeError("cpm must be positive");
  const rounded = (cpmUnits + 500n) / 1000n; // half-up (positive numbers par)
  return rounded < 1n ? 1n : rounded;
}
