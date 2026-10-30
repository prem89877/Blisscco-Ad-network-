import Link from "next/link";
import Button from "@/components/ui/Button";
import { CAMPAIGN_STATUSES, CATEGORY_OPTIONS, STATUS_LABELS, categoryLabel } from "@/lib/campaigns/constants";
import { SEARCH_MAX, hasActiveFilters, type CampaignFilters as Filters } from "@/lib/campaigns/filters";

type Props = { action: string; filters: Filters };

const field =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-mist placeholder:text-mist/40";

/**
 * Plain GET form (JavaScript ke bina bhi chalta hai). Submit par URL badalta hai aur server
 * naye filters se database se data laata hai.
 */
export default function CampaignFilters({ action, filters }: Props) {
  const extraCategory =
    filters.category !== "" && !CATEGORY_OPTIONS.some((o) => o.value === filters.category) ? filters.category : null;

  return (
    <form method="get" action={action} role="search" aria-label="Filter campaigns" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <label className="block text-sm text-mist/70 sm:col-span-2 lg:col-span-1">
          Search by name
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            maxLength={SEARCH_MAX}
            placeholder="Campaign name"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block text-sm text-mist/70">
          Status
          <select name="status" defaultValue={filters.status} className={`mt-1 ${field}`}>
            <option value="">All statuses</option>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-mist/70">
          Category
          <select name="category" defaultValue={filters.category} className={`mt-1 ${field}`}>
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {extraCategory && <option value={extraCategory}>{categoryLabel(extraCategory)}</option>}
          </select>
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="secondary" className="sm:w-44">
          Apply filters
        </Button>
        {hasActiveFilters(filters) && (
          <Link href={action} className="inline-flex min-h-11 items-center text-sm text-aqua underline-offset-2 hover:underline">
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
