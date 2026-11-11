import { splitCharge } from "./revenue-share";

// Pure server-side financial reconciliation module.
// BigInt only, no float, no DB, no env, no client imports. 1 unit = $0.0001 USD.

export type SplitReconciliation = {
  publisherUnits: bigint;
  platformUnits: bigint;
  balanced: boolean;
};

/**
 * Reconciles a single charge split against revenue-share bps.
 * Calls splitCharge from revenue-share.ts directly.
 */
export function reconcileSplit(chargeUnits: bigint, shareBps: number): SplitReconciliation {
  const split = splitCharge(chargeUnits, shareBps);
  const balanced = split.publisherUnits + split.platformUnits === chargeUnits;
  return {
    publisherUnits: split.publisherUnits,
    platformUnits: split.platformUnits,
    balanced,
  };
}

export type LedgerEntryForReconciliation = {
  type?: string;
  entryType?: string;
  entry_type?: string;
  amount: bigint;
  sourceType?: string;
  source_type?: string;
  sourceRef?: string | null;
  source_ref?: string | null;
  reversesEntryId?: number | null;
  reverses_entry_id?: number | null;
};

export type ServeReconciliation = {
  serveRef: string;
  chargeUnits: bigint;
  publisherUnits: bigint;
  platformUnits: bigint;
  chargesCount: number;
  publisherCount: number;
  platformCount: number;
  reversalsCount: number;
  reversalsTotalUnits: bigint;
  adjustmentsCount: number;
  adjustmentsTotalUnits: bigint;
  balanced: boolean;
  reason?: "ok" | "missing_charge" | "split_mismatch" | "duplicate_charge";
};

function normalizeType(e: LedgerEntryForReconciliation): string {
  return String(e.type ?? e.entryType ?? e.entry_type ?? "").trim();
}

function normalizeSourceRef(e: LedgerEntryForReconciliation): string | null {
  const ref = e.sourceRef ?? e.source_ref;
  return typeof ref === "string" && ref.trim() !== "" ? ref.trim() : null;
}

/**
 * Groups ledger entries by serve_ref and reconciles:
 * charge == publisher_earning + platform_revenue.
 * Reversals and adjustments are segregated and do NOT pollute the serve balance.
 */
export function reconcileServeEntries(
  entries: ReadonlyArray<LedgerEntryForReconciliation>,
): Map<string, ServeReconciliation> {
  const map = new Map<string, ServeReconciliation>();

  for (const entry of entries) {
    const serveRef = normalizeSourceRef(entry);
    if (!serveRef) continue;

    let rec = map.get(serveRef);
    if (!rec) {
      rec = {
        serveRef,
        chargeUnits: 0n,
        publisherUnits: 0n,
        platformUnits: 0n,
        chargesCount: 0,
        publisherCount: 0,
        platformCount: 0,
        reversalsCount: 0,
        reversalsTotalUnits: 0n,
        adjustmentsCount: 0,
        adjustmentsTotalUnits: 0n,
        balanced: false,
      };
      map.set(serveRef, rec);
    }

    const type = normalizeType(entry);
    switch (type) {
      case "advertiser_charge":
        rec.chargeUnits += entry.amount;
        rec.chargesCount += 1;
        break;
      case "publisher_earning":
        rec.publisherUnits += entry.amount;
        rec.publisherCount += 1;
        break;
      case "platform_revenue":
        rec.platformUnits += entry.amount;
        rec.platformCount += 1;
        break;
      case "reversal":
        rec.reversalsCount += 1;
        rec.reversalsTotalUnits += entry.amount;
        break;
      case "adjustment":
        rec.adjustmentsCount += 1;
        rec.adjustmentsTotalUnits += entry.amount;
        break;
      default:
        break;
    }
  }

  for (const rec of map.values()) {
    if (rec.chargesCount === 0) {
      rec.balanced = false;
      rec.reason = "missing_charge";
    } else if (rec.chargesCount > 1) {
      rec.balanced = false;
      rec.reason = "duplicate_charge";
    } else if (rec.publisherUnits + rec.platformUnits !== rec.chargeUnits) {
      rec.balanced = false;
      rec.reason = "split_mismatch";
    } else {
      rec.balanced = true;
      rec.reason = "ok";
    }
  }

  return map;
}
