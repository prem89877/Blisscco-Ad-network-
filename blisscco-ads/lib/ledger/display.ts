import { formatMoney } from "./decimal";

// Paise dikhane ka EK tareeka (publisher earnings page). Pure: BigInt "units" -> text. Float / Number() / toFixed kahin nahi.
// Hamesha 4 decimal (ledger numeric(14,4) jaisa), kyunki ek serve ki kamai 1 cent se bahut chhoti ho sakti hai (0.0020 USD).
// "$1,234.5600 USD", negative => "-$0.0050 USD". Currency har amount ke saath likhi jaati hai.

export const LEDGER_CURRENCY = "USD" as const;

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatUsdUnits(units: bigint): string {
  const plain = formatMoney(units); // "-1234.5600"
  const neg = plain.startsWith("-");
  const [whole, frac] = (neg ? plain.slice(1) : plain).split(".");
  return `${neg ? "-" : ""}$${groupThousands(whole)}.${frac} ${LEDGER_CURRENCY}`;
}
