import { MAX_UNITS } from "./decimal";

// Publisher / platform ka batwara.
// Business approval: 90% Publisher / 10% Blisscco Platform (setting value 9000 bps in DB, set on TEST only).
// The percentage is NEVER hardcoded in runtime code; it is read dynamically from ledger_settings.publisher_share_bps.
// Khali (NULL) = batwara NA-DEFINED: sirf advertiser_charge likha jata hai, publisher_earning / platform_revenue kuch nahi.
//
// RULE (SQL private.ledger_record_event ke saath bilkul same):
//   publisher_earning = TRUNCATE(charge x bps / 10000)  (4 decimal, neeche ki taraf)
//   platform_revenue  = charge - publisher_earning       (bacha hua poora, isliye jodh hamesha charge ke barabar)
//   Agar publisher_earning 0 nikle (bahut chhoti charge x chhota bps) toh uski entry nahi banti (ledger me amount 0 mana hai) aur platform ko poora charge.

export const BPS_DENOMINATOR = 10_000n;

/** bps sahi hai? integer, 0..10000. Number/float, string, NaN, negative, 10001: sab galat. */
export function isValidShareBps(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000;
}

export type ShareSplit = { publisherUnits: bigint; platformUnits: bigint };

/** charge (units, > 0) ko bps ke hisaab se baanto. Jodh hamesha charge ke barabar (koi paisa na banta hai na ghat'ta hai). */
export function splitCharge(chargeUnits: bigint, shareBps: number): ShareSplit {
  if (chargeUnits <= 0n || chargeUnits > MAX_UNITS) throw new RangeError("charge must be positive and within range");
  if (!isValidShareBps(shareBps)) throw new RangeError("share bps must be an integer from 0 to 10000");
  const publisherUnits = (chargeUnits * BigInt(shareBps)) / BPS_DENOMINATOR; // BigInt division = truncate (charge > 0)
  return { publisherUnits, platformUnits: chargeUnits - publisherUnits };
}
