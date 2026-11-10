import Panel from "@/components/dashboard/Panel";
import type { AdminCountryOverview } from "@/lib/regions/admin-country-queries";
import {
  describeAdvertiserCountry,
  describePublisherCountry,
  summarizeAdvertiserCountries,
  summarizePublisherCountries,
} from "@/lib/regions/admin-country-overview";

// Admin ke liye READ-ONLY country overview (Phase 6 Step 3 Part 3). Yahan koi button / form / server action nahi hai:
// publisher country approve / reject sirf maujooda "Publisher countries" panel (Step 2) se hota hai.
// Advertiser country sirf jaankari hai, uska koi approval nahi.

const SHOW_MAX = 15;

function Line({ label, value }: { label: string; value: number }) {
  return (
    <span className="mr-4 inline-block text-xs text-mist/70">
      {label}: <span className="text-mist">{value}</span>
    </span>
  );
}

function More({ total }: { total: number }) {
  return total > SHOW_MAX ? <li className="text-xs text-mist/60">And {total - SHOW_MAX} more.</li> : null;
}

export default function CountryOverviewPanel({ overview }: { overview: AdminCountryOverview }) {
  const { publishers, advertisers } = overview;
  const pubSummary = publishers ? summarizePublisherCountries(publishers) : null;
  const advSummary = advertisers ? summarizeAdvertiserCountries(advertisers) : null;
  const pubAttention = publishers ? publishers.filter((p) => p.incompleteOrInvalid) : [];
  const advAttention = advertisers ? advertisers.filter((a) => a.incompleteOrInvalid) : [];

  return (
    <Panel
      title="Country overview"
      note="Read-only. To verify or reject a publisher country, use the Publisher countries section below. Advertiser country is profile information only and needs no approval."
    >
      <div className="space-y-5">
        <section aria-label="Publisher countries summary">
          <h3 className="text-sm font-medium text-mist">Publishers</h3>
          {pubSummary === null ? (
            <p className="mt-2 text-sm text-red-300">Publisher countries could not be loaded. Please refresh the page.</p>
          ) : (
            <>
              <p className="mt-2">
                <Line label="Total" value={pubSummary.total} />
                <Line label="Verified" value={pubSummary.verified} />
                <Line label="Waiting" value={pubSummary.pending} />
                <Line label="Not accepted" value={pubSummary.rejected} />
                <Line label="Not submitted" value={pubSummary.missing} />
                <Line label="Invalid / incomplete" value={pubSummary.invalidCountry + pubSummary.incomplete} />
              </p>
              {pubAttention.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {pubAttention.slice(0, SHOW_MAX).map((p) => (
                    <li key={p.id} className="rounded-xl border border-line p-3">
                      <p className="break-words text-sm font-medium text-mist">{p.name}</p>
                      <p className="mt-1 text-xs text-amber-300">{describePublisherCountry(p)}</p>
                      {p.state === "invalid_country" && (
                        <p className="mt-1 text-xs text-mist/60">A country that is not an official ISO code cannot be verified. Reject it in Publisher countries.</p>
                      )}
                    </li>
                  ))}
                  <More total={pubAttention.length} />
                </ul>
              )}
              {overview.publishersTruncated && <p className="mt-2 text-xs text-mist/60">Showing the latest {publishers?.length ?? 0} publishers only.</p>}
            </>
          )}
        </section>

        <section aria-label="Advertiser countries summary">
          <h3 className="text-sm font-medium text-mist">Advertisers</h3>
          {advSummary === null ? (
            <p className="mt-2 text-sm text-red-300">Advertiser countries could not be loaded. Please refresh the page.</p>
          ) : (
            <>
              <p className="mt-2">
                <Line label="Total" value={advSummary.total} />
                <Line label="Country set" value={advSummary.valid} />
                <Line label="Not chosen" value={advSummary.missing} />
                <Line label="Invalid" value={advSummary.invalid} />
              </p>
              {advAttention.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {advAttention.slice(0, SHOW_MAX).map((a) => (
                    <li key={a.id} className="rounded-xl border border-line p-3">
                      <p className="break-words text-sm font-medium text-mist">{a.name}</p>
                      <p className="mt-1 text-xs text-amber-300">{describeAdvertiserCountry(a)}</p>
                    </li>
                  ))}
                  <More total={advAttention.length} />
                </ul>
              )}
              {overview.advertisersTruncated && <p className="mt-2 text-xs text-mist/60">Showing the latest {advertisers?.length ?? 0} advertisers only.</p>}
            </>
          )}
        </section>
      </div>
    </Panel>
  );
}
