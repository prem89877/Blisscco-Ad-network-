import { fake, type FakeCampaign } from "./action-stubs"; // SABSE PEHLE: nakli modules lagte hain
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CAMPAIGN_STATUSES, STATUS_HELP, STATUS_LABELS } from "@/lib/campaigns/constants";
import { DELIVERY_MESSAGES, NOT_ACTIVE_MESSAGES, SERVING_MESSAGE, deliveryState, type DeliveryInput } from "@/lib/campaigns/delivery";
import { RESUME_BLOCK_MESSAGES, canPause, checkResume } from "@/lib/campaigns/run-state";
import { REVIEW_ACTIONS } from "@/lib/campaigns/review";
import { CREATIVE_ACTIONS, CREATIVE_STATUSES, CREATIVE_STATUS_LABELS } from "@/lib/campaigns/creative-validation";
import { mapDbError } from "@/lib/campaigns/errors";
import { pauseCampaign, resumeCampaign } from "@/app/dashboard/advertiser/campaigns/actions";

// Day 9 Part 4: campaign lifecycle. Paused / unapproved / out-of-schedule / no-budget campaigns must not serve,
// resume must not bypass approval or eligibility, and UI labels must match the database state.
// Nakli database; SQL file ki sirf STATIC jaanch (text padhkar). Asli SQL test day-9-8 file se Supabase me hota hai.

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const TODAY = "2026-10-27";
const CAMP = "11111111-1111-4111-8111-111111111111";

function input(over: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    status: "active",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    totalBudget: 100,
    dailyBudget: 10,
    approvedCreatives: 1,
    spentTotal: 0,
    spentToday: 0,
    todayUtc: TODAY,
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe("day 9 part 4: deliveryState (is the 'Active' label telling the truth?)", () => {
  it("a healthy active campaign is eligible", () => {
    assert.deepEqual(deliveryState(input()), { serving: true, reason: null, message: SERVING_MESSAGE });
  });

  it("every status other than active never serves, with its own message", () => {
    for (const status of CAMPAIGN_STATUSES.filter((s) => s !== "active")) {
      const r = deliveryState(input({ status }));
      assert.equal(r.serving, false, status);
      assert.equal(r.reason, "campaign_not_active", status);
      assert.equal(r.message, NOT_ACTIVE_MESSAGES[status], status);
    }
  });

  it("active but outside its schedule: ended / not started", () => {
    assert.equal(deliveryState(input({ endDate: "2026-10-26" })).reason, "ended");
    assert.equal(deliveryState(input({ startDate: "2026-10-28" })).reason, "not_started");
    // sirhad: end_date = aaj abhi chalta hai, start_date = aaj abhi chalta hai (database bhi <= / >= lagata hai)
    assert.equal(deliveryState(input({ endDate: TODAY })).serving, true);
    assert.equal(deliveryState(input({ startDate: TODAY })).serving, true);
    assert.equal(deliveryState(input({ endDate: null })).serving, true);
  });

  it("active but no approved ad", () => {
    const r = deliveryState(input({ approvedCreatives: 0 }));
    assert.equal(r.reason, "no_approved_creative");
    assert.equal(r.message, DELIVERY_MESSAGES.no_approved_creative);
  });

  it("active but budget used up: total and daily", () => {
    assert.equal(deliveryState(input({ spentTotal: 100 })).reason, "total_budget_used");
    assert.equal(deliveryState(input({ spentTotal: 99.9985 })).reason, "total_budget_used", "less than one serve (0.002) left");
    assert.equal(deliveryState(input({ spentTotal: 99.99 })).serving, true, "exactly enough for more serves");
    assert.equal(deliveryState(input({ spentToday: 10 })).reason, "daily_budget_used");
    assert.equal(deliveryState(input({ dailyBudget: null, spentToday: 9999 })).serving, true, "no daily limit");
  });

  it("an advertiser account that is not active makes an 'Active' campaign not serve", () => {
    assert.equal(deliveryState(input({ advertiserActive: false })).reason, "advertiser_not_active");
    assert.equal(deliveryState(input({ advertiserActive: true })).serving, true);
    assert.equal(deliveryState(input({})).serving, true, "unknown = not blocked");
  });

  it("unknown data (null) never blocks: only what we know is used", () => {
    assert.equal(deliveryState(input({ approvedCreatives: null, spentTotal: null, spentToday: null })).serving, true);
    // par jo pata hai wo phir bhi rokta hai (list page sirf dates se kaam chalata hai)
    assert.equal(deliveryState(input({ approvedCreatives: null, spentTotal: null, spentToday: null, endDate: "2020-01-01" })).reason, "ended");
  });

  it("float noise does not flip the answer (0.1 + 0.2 style sums)", () => {
    assert.equal(deliveryState(input({ totalBudget: 0.3, spentTotal: 0.1 + 0.2 })).reason, "total_budget_used");
    assert.equal(deliveryState(input({ totalBudget: 1, dailyBudget: 0.5, spentToday: 0.499 })).serving, false);
    assert.equal(deliveryState(input({ totalBudget: 1, dailyBudget: 0.5, spentToday: 0.498 })).serving, true, "exactly one serve left");
  });

  it("ended wins over the other reasons (one clear message)", () => {
    const r = deliveryState(input({ endDate: "2026-01-01", approvedCreatives: 0, spentTotal: 100 }));
    assert.equal(r.reason, "ended");
  });
});

// ---------------------------------------------------------------------------
describe("day 9 part 4: checkResume (friendly check; the database trigger is the real wall)", () => {
  const paused = { status: "paused" as const, endDate: null, totalBudget: 100 };

  it("allows a paused campaign with an approved ad, in schedule, with budget left", () => {
    assert.deepEqual(checkResume(paused, 1, TODAY, 10), { ok: true });
  });
  it("blocks anything that is not paused", () => {
    for (const status of CAMPAIGN_STATUSES.filter((s) => s !== "paused")) {
      assert.deepEqual(checkResume({ ...paused, status }, 1, TODAY, 0), { ok: false, reason: "not_paused" }, status);
    }
  });
  it("blocks when no approved ad (approval cannot be bypassed by resuming)", () => {
    assert.deepEqual(checkResume(paused, 0, TODAY, 0), { ok: false, reason: "no_approved_creative" });
  });
  it("blocks when the end date has passed", () => {
    assert.deepEqual(checkResume({ ...paused, endDate: "2026-10-26" }, 1, TODAY, 0), { ok: false, reason: "ended" });
    assert.deepEqual(checkResume({ ...paused, endDate: TODAY }, 1, TODAY, 0), { ok: true });
  });
  it("NEW: blocks when the total budget is fully spent", () => {
    assert.deepEqual(checkResume(paused, 1, TODAY, 100), { ok: false, reason: "budget_used" });
    assert.deepEqual(checkResume(paused, 1, TODAY, 100.5), { ok: false, reason: "budget_used" });
    assert.equal(RESUME_BLOCK_MESSAGES.budget_used.length > 10, true);
  });
  it("unknown spend / old 3-argument call does not block (database decides)", () => {
    assert.deepEqual(checkResume(paused, 1, TODAY, null), { ok: true });
    assert.deepEqual(checkResume(paused, 1, TODAY), { ok: true });
    assert.deepEqual(checkResume({ status: "paused", endDate: null }, 1, TODAY, 5), { ok: true }, "no totalBudget given");
  });
  it("only an active campaign can be paused", () => {
    for (const status of CAMPAIGN_STATUSES) assert.equal(canPause(status), status === "active", status);
  });
});

// ---------------------------------------------------------------------------
function campaign(over: Partial<FakeCampaign> = {}): FakeCampaign {
  return {
    id: CAMP,
    advertiserId: "adv-A",
    name: "Diwali sale",
    description: null,
    category: "lifestyle",
    status: "paused",
    totalBudget: 100,
    dailyBudget: null,
    startDate: "2026-10-01",
    endDate: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...over,
  };
}
function fd(): FormData {
  const f = new FormData();
  f.set("campaignId", CAMP);
  return f;
}
const dbCalls = () => fake.calls.filter((c) => c.table === "campaigns");
async function resume() {
  return resumeCampaign({ status: "idle" }, fd()).then(
    (r) => ({ kind: "result" as const, r }),
    (e: Error) => ({ kind: "threw" as const, message: e.message }),
  );
}

describe("day 9 part 4: resume server action (status transitions + responses)", () => {
  beforeEach(() => fake.reset());

  it("resume of a healthy paused campaign: ONE update paused -> active, filtered by status + advertiser, then redirect", async () => {
    fake.campaigns = [campaign()];
    fake.spend = { spentTotal: 10, spentToday: 0, servesTotal: 5 };
    const out = await resume();
    assert.equal(out.kind, "threw");
    if (out.kind === "threw") assert.match(out.message, /^REDIRECT:.*\?resumed=1$/);
    assert.equal(dbCalls().length, 1);
    assert.deepEqual(dbCalls()[0].payload, { status: "active" });
    assert.deepEqual(dbCalls()[0].filters, [["id", CAMP], ["advertiser_id", "adv-A"], ["status", "paused"]]);
  });

  it("no approved ad => error, database is never written (resume cannot bypass approval)", async () => {
    fake.campaigns = [campaign()];
    fake.creatives = { total: 2, approved: 0 };
    const out = await resume();
    assert.deepEqual(out, { kind: "result", r: { status: "error", message: RESUME_BLOCK_MESSAGES.no_approved_creative } });
    assert.equal(dbCalls().length, 0);
  });

  it("end date passed => error, nothing written", async () => {
    fake.campaigns = [campaign({ endDate: "2000-01-01" })];
    const out = await resume();
    assert.deepEqual(out, { kind: "result", r: { status: "error", message: RESUME_BLOCK_MESSAGES.ended } });
    assert.equal(dbCalls().length, 0);
  });

  it("NEW: total budget fully spent => error, nothing written", async () => {
    fake.campaigns = [campaign({ totalBudget: 50 })];
    fake.spend = { spentTotal: 50, spentToday: 1, servesTotal: 25000 };
    const out = await resume();
    assert.deepEqual(out, { kind: "result", r: { status: "error", message: RESUME_BLOCK_MESSAGES.budget_used } });
    assert.equal(dbCalls().length, 0);
  });

  it("spend cannot be read => the action does not guess; the database trigger decides (and its error is mapped)", async () => {
    fake.campaigns = [campaign()];
    fake.spend = null;
    fake.dbError = { code: "42501", hint: "resume_budget_exhausted" };
    const out = await resume();
    assert.deepEqual(out, { kind: "result", r: { status: "error", message: mapDbError({ code: "42501", hint: "resume_budget_exhausted" }) } });
    assert.match((out as { r: { message: string } }).r.message, /no budget left/);
  });

  it("every non-paused status is refused without touching the database", async () => {
    for (const status of CAMPAIGN_STATUSES.filter((s) => s !== "paused")) {
      fake.reset();
      fake.campaigns = [campaign({ status })];
      const out = await resume();
      assert.deepEqual(out, { kind: "result", r: { status: "error", message: RESUME_BLOCK_MESSAGES.not_paused } }, status);
      assert.equal(dbCalls().length, 0, status);
    }
  });

  it("an advertiser account that is not active cannot resume or pause", async () => {
    fake.campaigns = [campaign()];
    fake.me = { id: "adv-A", status: "suspended" };
    const a = await resume();
    const b = await pauseCampaign({ status: "idle" }, fd()).then((r) => r);
    assert.equal(a.kind, "result");
    assert.equal(b.status, "error");
    assert.equal(dbCalls().length, 0);
  });

  it("another advertiser's campaign looks like 'not found' (no write)", async () => {
    fake.campaigns = [campaign({ advertiserId: "adv-B" })];
    const out = await resume();
    assert.deepEqual(out, { kind: "result", r: { status: "error", message: "Campaign not found." } });
    assert.equal(dbCalls().length, 0);
  });

  it("not logged in / wrong role => redirect before any database call", async () => {
    fake.campaigns = [campaign()];
    fake.roleFails = true;
    const out = await resume();
    assert.equal(out.kind, "threw");
    assert.equal(dbCalls().length, 0);
  });

  it("pause only touches an ACTIVE campaign", async () => {
    fake.campaigns = [campaign({ status: "draft" })];
    const r = await pauseCampaign({ status: "idle" }, fd());
    assert.equal(r.status, "error");
    assert.equal(dbCalls().length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("day 9 part 4: an advertiser can never reach 'active' or 'approved' by themselves", () => {
  it("campaign review actions never target active", () => {
    for (const [name, rule] of Object.entries(REVIEW_ACTIONS)) {
      assert.notEqual(rule.to, "active", name);
      assert.notEqual(rule.from, "paused", name);
    }
  });
  it("creative actions never target approved (only an admin function sets approved)", () => {
    for (const [name, rule] of Object.entries(CREATIVE_ACTIONS)) {
      assert.notEqual(rule.to, "approved", name);
      assert.notEqual(rule.to, "rejected", name);
    }
  });
  it("the advertiser server code never writes review columns or calls admin functions", () => {
    for (const f of [
      "app/dashboard/advertiser/campaigns/actions.ts",
      "app/dashboard/advertiser/campaigns/creative-actions.ts",
    ]) {
      const s = read(f);
      assert.equal(/admin_review|admin_set|createAdminClient|reviewed_by|reviewed_at|rejection_reason/.test(s), false, f);
      assert.equal(/status:\s*["']active["']/.test(s.replace(/changeRunState[\s\S]*$/m, "")), false, `${f}: no direct active outside resume`);
    }
  });
  it("the only advertiser write to 'active' is the resume path, guarded by from-status paused", () => {
    const s = read("app/dashboard/advertiser/campaigns/actions.ts");
    assert.match(s, /\.eq\("status", from\)/);
    assert.match(s, /const from = to === "paused" \? "active" : "paused"/);
  });
});

// ---------------------------------------------------------------------------
describe("day 9 part 4: the SQL migration (static check; it does not RUN the SQL)", () => {
  const sql = read("supabase/sql/day-9-7-lifecycle-guards.sql");
  const body = sql.replace(/^--.*$/gm, ""); // sirf code, comments nahi
  const day43 = read("supabase/sql/day-4-3-campaign-description.sql");

  it("keeps the exact advertiser transition list of day-4-3 (no new allowed transition)", () => {
    const block = (s: string) => {
      const start = s.indexOf("(old.status, new.status) not in (");
      return s.slice(start, s.indexOf(") then", start));
    };
    const tuples = (s: string) =>
      (block(s).match(/\(\s*'[a-z_]+'\s*,\s*'[a-z_]+'\s*\)/g) ?? []).map((t) => t.replace(/\s+/g, ""));
    const old = tuples(day43);
    const now = tuples(body);
    assert.equal(old.length, 9);
    assert.deepEqual(now, old);
  });

  it("keeps the strings the day-8 verify query looks for", () => {
    for (const needle of ["campaign_limit_reached", "resume_needs_approved_creative", "new.description"]) {
      assert.ok(body.includes(needle), needle);
    }
  });

  it("resume now checks budget, and 'today' is UTC (not the session timezone)", () => {
    const guard = body.slice(body.indexOf("function private.guard_campaign_changes"), body.indexOf("function public.admin_review_campaign"));
    assert.ok(guard.includes("resume_budget_exhausted"));
    assert.ok(guard.includes("private.campaign_can_afford_serve(new.id, new.total_budget)"));
    assert.ok(guard.includes("(now() at time zone 'utc')::date"));
    assert.equal(/current_date/.test(guard), false);
  });

  it("admin functions: still admin-only, still not callable by anon, self-approval and eligibility blocked", () => {
    for (const fn of ["admin_review_campaign", "admin_review_creative"]) {
      const start = body.indexOf(`function public.${fn}`);
      const end = body.indexOf("$$;", body.indexOf("$$;", start) + 3);
      const def = body.slice(start, end);
      assert.ok(def.includes("if not private.is_admin()"), `${fn}: admin check first`);
      assert.ok(def.includes("security definer"), fn);
      assert.ok(def.includes("set search_path = ''"), fn);
      assert.ok(def.includes("self_approval_blocked"), fn);
      assert.ok(def.includes("advertiser_not_active"), fn);
    }
    const campaign = body.slice(body.indexOf("function public.admin_review_campaign"), body.indexOf("function public.admin_review_creative"));
    for (const hint of ["approve_needs_creative", "approve_campaign_ended", "approve_needs_budget"]) assert.ok(campaign.includes(hint), hint);
    assert.match(body, /revoke all on function public\.admin_review_campaign\(uuid, text\)\s+from public, anon;/);
    assert.match(body, /revoke all on function public\.admin_review_creative\(uuid, text, text\)\s+from public, anon;/);
    assert.match(body, /grant execute on function public\.admin_review_campaign\(uuid, text\)\s+to authenticated;/);
  });

  it("the budget helper leaks nothing: only the owner or an admin gets a real answer", () => {
    const helper = body.slice(body.indexOf("function private.campaign_can_afford_serve"), body.indexOf("function private.guard_campaign_changes"));
    assert.ok(helper.includes("private.is_admin()"));
    assert.ok(helper.includes("private.my_advertiser_id()"));
    assert.match(body, /revoke all on function private\.campaign_can_afford_serve\(uuid, numeric\) from public, anon;/);
    assert.equal(/grant execute on function private\.campaign_can_afford_serve\(uuid, numeric\) to (anon|public)/.test(body), false);
  });

  it("replay now checks schedule, advertiser and profile, and keeps its lock-down", () => {
    const fn = body.slice(body.indexOf("function private.replay_serve"), body.indexOf("function public.load_ad_candidates"));
    for (const needle of ["c.start_date <= v_today", "c.end_date >= v_today", "a.status  = 'active'", "ap.status = 'active'", "x.status = 'approved'", "c.status = 'active'"]) {
      assert.ok(fn.includes(needle), needle);
    }
    assert.match(body, /revoke all on function private\.replay_serve\(uuid, text\) from public, anon, authenticated, service_role;/);
  });

  it("load_ad_candidates: same columns and grants, plus a budget filter", () => {
    const old = read("supabase/sql/day-5-6-load-candidates.sql");
    const cols = (s: string) => (s.match(/^\s{2}[a-z_]+\s+(uuid|text|date|numeric|integer),?$/gm) ?? []).map((l) => l.trim());
    assert.deepEqual(cols(body), cols(old));
    assert.match(body, /< c\.total_budget/);
    assert.match(body, /grant execute on function public\.load_ad_candidates\(text, date\) to service_role;/);
    assert.match(body, /revoke all on function public\.load_ad_candidates\(text, date\) from public, anon, authenticated;/);
  });

  it("does not weaken security or change data: no RLS/policy/grant-to-anon changes, no drops, no data writes, no new status", () => {
    assert.equal(/disable row level security|drop policy|create policy|using \(true\)|drop table|drop column|truncate/i.test(body), false);
    assert.equal(/\b(insert into|delete from)\b/i.test(body), false);
    assert.equal(/grant [^;]*\bto\b[^;]*\b(anon|public)\b/i.test(body), false);
    assert.equal(/\bupdate public\.(?!campaigns set status = 'active' where id = p_campaign_id|campaigns set status = 'rejected' where id = p_campaign_id|ad_creatives\b)/.test(body), false);
    const statuses = new Set([...body.matchAll(/status\s*(?:=|<>|!=)\s*'([a-z_]+)'/g)].map((m) => m[1]));
    const known = new Set([...CAMPAIGN_STATUSES, ...CREATIVE_STATUSES, "suspended"]);
    for (const s of statuses) assert.ok(known.has(s as never), `unknown status value in SQL: ${s}`);
  });

  it("is idempotent: only create-or-replace, wrapped in one transaction", () => {
    assert.equal(/^\s*create function/im.test(body), false);
    assert.ok(/^\s*begin;/m.test(body) && /^\s*commit;/m.test(body));
  });
});

// ---------------------------------------------------------------------------
describe("day 9 part 4: UI labels stay consistent with database state", () => {
  it("status labels and help exist for exactly the 7 database statuses (values preserved)", () => {
    assert.deepEqual([...CAMPAIGN_STATUSES], ["draft", "pending_review", "active", "paused", "completed", "rejected", "archived"]);
    assert.deepEqual(Object.keys(STATUS_LABELS).sort(), [...CAMPAIGN_STATUSES].sort());
    assert.deepEqual(Object.keys(STATUS_HELP).sort(), [...CAMPAIGN_STATUSES].sort());
    const check = read("supabase/sql/day-3-3-campaign.sql").match(/status in \(([^)]*)\)/)?.[1] ?? "";
    assert.deepEqual([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...CAMPAIGN_STATUSES]);
  });

  it("creative labels cover exactly the database creative statuses", () => {
    const check = read("supabase/sql/day-3-4-ad-creative.sql").match(/status in \(([^)]*)\)/)?.[1] ?? "";
    assert.deepEqual([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), [...CREATIVE_STATUSES]);
    assert.deepEqual(Object.keys(CREATIVE_STATUS_LABELS).sort(), [...CREATIVE_STATUSES].sort());
  });

  it("'Active' help no longer promises ads without conditions", () => {
    assert.doesNotMatch(STATUS_HELP.active, /live\./i);
    assert.match(STATUS_HELP.active, /approved ad/);
    assert.match(STATUS_HELP.active, /budget/);
    assert.match(STATUS_HELP.paused, /approved ad/);
    assert.match(STATUS_HELP.paused, /budget/);
  });

  it("the campaign page shows the delivery line for active campaigns and uses the budget-aware resume check", () => {
    const page = read("app/dashboard/advertiser/campaigns/[id]/page.tsx");
    assert.match(page, /deliveryState\(/);
    assert.match(page, /<DeliveryNote state=\{delivery\}/);
    assert.match(page, /checkResume\(campaign, creatives \? creatives\.approved : null, today, spend \? spend\.spentTotal : null\)/);
    assert.match(page, /advertiserActive: adv\.status === "active"/);
  });

  it("the list page flags active campaigns that are outside their dates, using only dates it really has", () => {
    const page = read("app/dashboard/advertiser/campaigns/page.tsx");
    assert.match(page, /deliveryState\(/);
    assert.match(page, /approvedCreatives: null/);
    assert.match(page, /state && !state\.serving/);
  });

  it("the badge still shows the raw database status (no invented status)", () => {
    const badge = read("components/campaigns/CampaignStatusBadge.tsx");
    assert.match(badge, /STATUS_LABELS\[status\]/);
  });

  it("the admin page hides 'Approve campaign' when it can never succeed, but always allows Reject", () => {
    const page = read("app/dashboard/admin/page.tsx");
    assert.match(page, /campaignApproveBlock\(c, c\.approvedAds, today\)/);
    assert.match(page, /\{!block && <AdminDecisionButton kind="campaign" id=\{c\.id\} decision="approve"/);
    assert.match(page, /decision="reject" label="Reject campaign"/);
    assert.match(page, /requireRole\(\["admin"\]\)/);
  });
});
