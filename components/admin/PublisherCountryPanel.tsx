import Panel from "@/components/dashboard/Panel";
import PublisherCountryReviewButton from "@/components/admin/PublisherCountryReviewButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import {
  COUNTRY_STATUS_LABELS,
  countryDisplayName,
  isCountryVerificationStatus,
  parseCountrySubmission,
  type CountryVerificationStatus,
} from "@/lib/regions/publisher-country";
import { REGION_LABELS } from "@/lib/regions/country-region";

type Row = { id: string; name: string; code: string; status: CountryVerificationStatus; submittedAt: string | null };

// Admin ke liye: publisher countries jo verification ka intezaar kar rahi hain (aur haal me verify/reject hui). Alag query:
// SQL abhi apply na hui ho toh sirf ye panel "could not be loaded" dikhata hai, baaki admin page nahi tootta.
async function loadCountryRows(): Promise<Row[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("publishers")
      .select("id, name, country_code, country_status, country_submitted_at")
      .not("country_status", "is", null)
      .order("country_submitted_at", { ascending: true })
      .limit(100);
    if (error) return null;
    const rows: Row[] = [];
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.country_code !== "string") continue;
      if (!isCountryVerificationStatus(r.country_status)) continue;
      rows.push({ id: r.id, name: r.name, code: r.country_code, status: r.country_status, submittedAt: typeof r.country_submitted_at === "string" ? r.country_submitted_at : null });
    }
    return rows;
  } catch {
    return null;
  }
}

const TONES: Record<CountryVerificationStatus, string> = { pending: "text-amber-300", verified: "text-aqua", rejected: "text-red-300" };

export default async function PublisherCountryPanel() {
  const rows = await loadCountryRows();
  const sorted = rows ? [...rows].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")) : [];
  return (
    <Panel
      title="Publisher countries"
      note="Only a verified country is used for regional ads. Pending, rejected, missing or invalid countries get no regional ads."
    >
      {rows === null ? (
        <p className="text-sm text-red-300">Countries could not be loaded. Please refresh the page.</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-mist/70">No countries submitted yet.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((p) => {
            const resolved = parseCountrySubmission(p.code);
            return (
              <li key={p.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-mist">{p.name}</p>
                    <p className="mt-1 text-xs text-mist/60">
                      {resolved.ok ? `${countryDisplayName(resolved.countryCode)} · ${REGION_LABELS[resolved.region]}` : `${p.code} · not a valid ISO country code`}
                      {p.submittedAt ? ` · Submitted ${formatDate(p.submittedAt.slice(0, 10))}` : ""}
                    </p>
                    <p className={`mt-1 text-xs ${TONES[p.status]}`}>{COUNTRY_STATUS_LABELS[p.status]}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {p.status === "pending" && resolved.ok && (
                      <PublisherCountryReviewButton publisherId={p.id} expectedCountry={p.code} decision="approve" label="Verify country" />
                    )}
                    {p.status !== "rejected" && (
                      <PublisherCountryReviewButton publisherId={p.id} expectedCountry={p.code} decision="reject" label="Reject country" tone="bad" />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
