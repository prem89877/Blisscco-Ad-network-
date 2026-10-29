import type { Metadata } from "next";
import PageHeader from "@/components/dashboard/PageHeader";
import Panel from "@/components/dashboard/Panel";
import AdminDecisionButton from "@/components/admin/AdminDecisionButton";
import PayoutRequestsPanel from "@/components/admin/PayoutRequestsPanel";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/campaigns/constants";
import { toCreative, type Creative } from "@/lib/campaigns/creative-validation";
import { utcToday } from "@/lib/campaigns/validation";
import { CAMPAIGN_APPROVE_BLOCK_MESSAGES, campaignApproveBlock } from "@/lib/admin/decisions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Admin | Blisscco Dashboard" };
export const dynamic = "force-dynamic";

type Account = { id: string; name: string; website: string | null; status: string; createdAt: string; extra: string | null };
type PendingCampaign = {
  id: string;
  name: string;
  category: string;
  totalBudget: number;
  startDate: string;
  endDate: string | null;
  /** null = pata nahi chala (load fail): button block nahi, database final faisla karega. */
  approvedAds: number | null;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function loadAdminData() {
  const supabase = await createClient();
  const [advs, pubs, creatives, campaigns] = await Promise.all([
    supabase.from("advertisers").select("id, company_name, website_url, status, created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("publishers").select("id, name, website_url, status, category, created_at").order("created_at", { ascending: false }).limit(30),
    supabase
      .from("ad_creatives")
      .select("id, campaign_id, headline, body, cta_text, destination_url, status, rejection_reason")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("campaigns")
      .select("id, name, category, total_budget, start_date, end_date")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const toAccount = (nameKey: string, extraKey: string | null) => (row: unknown): Account | null => {
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const name = str(r[nameKey]);
    const status = str(r.status);
    const createdAt = str(r.created_at);
    if (!id || !name || !status || !createdAt) return null;
    return { id, name, website: str(r.website_url), status, createdAt, extra: extraKey ? str(r[extraKey]) : null };
  };

  const failed = Boolean(advs.error || pubs.error || creatives.error || campaigns.error);
  const advertisers = ((advs.data ?? []) as unknown[]).map(toAccount("company_name", null)).filter((a): a is Account => a !== null);
  const publishers = ((pubs.data ?? []) as unknown[]).map(toAccount("name", "category")).filter((a): a is Account => a !== null);
  const creativeRows = ((creatives.data ?? []) as unknown[]).map(toCreative).filter((c): c is Creative => c !== null);
  const campaignRows = ((campaigns.data ?? []) as Record<string, unknown>[])
    .map((r): PendingCampaign | null => {
      const id = str(r.id);
      const name = str(r.name);
      const category = str(r.category);
      const startDate = str(r.start_date);
      const total = typeof r.total_budget === "number" ? r.total_budget : Number(r.total_budget);
      if (!id || !name || !category || !startDate || !Number.isFinite(total)) return null;
      return { id, name, category, totalBudget: total, startDate, endDate: str(r.end_date), approvedAds: null };
    })
    .filter((c): c is PendingCampaign => c !== null);

  // Har pending campaign ke kitne ads approved hain (label sach rakhne ke liye; approve ka asli niyam database function me hai).
  let approvedFailed = false;
  if (campaignRows.length > 0) {
    const { data: approved, error: approvedError } = await supabase
      .from("ad_creatives")
      .select("campaign_id")
      .eq("status", "approved")
      .in("campaign_id", campaignRows.map((c) => c.id));
    if (approvedError || !approved) {
      approvedFailed = true;
    } else {
      const counts = new Map<string, number>();
      for (const row of approved as { campaign_id?: unknown }[]) {
        if (typeof row.campaign_id === "string") counts.set(row.campaign_id, (counts.get(row.campaign_id) ?? 0) + 1);
      }
      for (const c of campaignRows) c.approvedAds = counts.get(c.id) ?? 0;
    }
  }

  return { failed: failed || approvedFailed, advertisers, publishers, creatives: creativeRows, campaigns: campaignRows };
}

function AccountList({ kind, rows }: { kind: "advertiser" | "publisher"; rows: Account[] }) {
  // Pending sabse upar
  const sorted = [...rows].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  if (sorted.length === 0) return <p className="text-sm text-mist/70">None yet.</p>;
  return (
    <ul className="space-y-3">
      {sorted.map((a) => (
        <li key={a.id} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-mist">{a.name}</p>
              <p className="mt-1 break-all text-xs text-mist/60">
                {a.website ?? "No website"}
                {a.extra ? ` · ${categoryLabel(a.extra)}` : ""} · Joined {formatDate(a.createdAt.slice(0, 10))}
              </p>
              <p className={`mt-1 text-xs ${a.status === "active" ? "text-aqua" : a.status === "pending" ? "text-amber-300" : "text-red-300"}`}>
                {a.status === "active" ? "Active" : a.status === "pending" ? "Waiting for approval" : "Suspended"}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {a.status !== "active" && <AdminDecisionButton kind={kind} id={a.id} decision="active" label="Approve" />}
              {a.status !== "suspended" && (
                <AdminDecisionButton kind={kind} id={a.id} decision="suspended" label="Suspend" tone="bad" />
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminPage() {
  await requireRole(["admin"]);
  const data = await loadAdminData();
  const today = utcToday();
  const pendingAccounts =
    data.advertisers.filter((a) => a.status === "pending").length + data.publishers.filter((a) => a.status === "pending").length;

  return (
    <>
      <PageHeader
        demo={false}
        title="Admin review"
        description="Approve new accounts, ads and campaigns. Check each ad's text and web address before approving. Approve the ad first, then the campaign."
      />
      {data.failed && (
        <p role="alert" className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Some lists could not be loaded. Please refresh the page.
        </p>
      )}
      <p className="mb-6 text-sm text-mist/70">
        Waiting: {pendingAccounts} account(s), {data.creatives.length} ad(s), {data.campaigns.length} campaign(s).
      </p>

      <div className="space-y-6">
        <Panel title="Ads waiting for review" note="Web addresses are shown as plain text on purpose. Do not open links you do not trust.">
          {data.creatives.length === 0 ? (
            <p className="text-sm text-mist/70">Nothing waiting.</p>
          ) : (
            <ul className="space-y-3">
              {data.creatives.map((c) => (
                <li key={c.id} className="rounded-xl border border-line p-4">
                  <p className="break-words text-sm font-medium text-mist">{c.headline}</p>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-mist/80">{c.body}</p>
                  <p className="mt-1 break-all text-xs text-mist/60">
                    {c.ctaText ? `Button: ${c.ctaText} · ` : ""}
                    {c.destinationUrl}
                  </p>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <AdminDecisionButton kind="creative" id={c.id} decision="approve" label="Approve ad" />
                    <AdminDecisionButton kind="creative" id={c.id} decision="reject" label="Reject ad" tone="bad" needsReason />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Campaigns waiting for review" note="A campaign can be approved only after at least one of its ads is approved.">
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-mist/70">Nothing waiting.</p>
          ) : (
            <ul className="space-y-3">
              {data.campaigns.map((c) => {
                const block = campaignApproveBlock(c, c.approvedAds, today);
                return (
                  <li key={c.id} className="rounded-xl border border-line p-4">
                    <p className="break-words text-sm font-medium text-mist">{c.name}</p>
                    <p className="mt-1 text-xs text-mist/60">
                      {categoryLabel(c.category)} · Budget ${c.totalBudget.toFixed(2)} · {formatDate(c.startDate)} to{" "}
                      {c.endDate ? formatDate(c.endDate) : "no end date"}
                    </p>
                    <p className="mt-1 text-xs text-mist/60">
                      Approved ads: {c.approvedAds === null ? "could not be loaded" : c.approvedAds}
                    </p>
                    {block && <p className="mt-2 text-sm text-amber-300">{CAMPAIGN_APPROVE_BLOCK_MESSAGES[block]}</p>}
                    <div className="mt-3 flex flex-wrap items-start gap-2">
                      {!block && <AdminDecisionButton kind="campaign" id={c.id} decision="approve" label="Approve campaign" />}
                      <AdminDecisionButton kind="campaign" id={c.id} decision="reject" label="Reject campaign" tone="bad" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Advertisers" note="Latest 30. New accounts wait here until you approve them.">
          <AccountList kind="advertiser" rows={data.advertisers} />
        </Panel>

        <Panel title="Publishers" note="Latest 30. A publisher's API key works only while the account is active.">
          <AccountList kind="publisher" rows={data.publishers} />
        </Panel>

        <PayoutRequestsPanel />
      </div>
    </>
  );
}
