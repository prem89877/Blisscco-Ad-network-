import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

// Phase 6 Step 4 Part 2: valid impression / valid click billing, ASLI Postgres par (functions: record_ad_serve, record_ad_impression, record_ad_click).
//
// !! SIRF alag TEST Supabase project (denim) par (guard: test-db-guard.ts). TEST env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! Prerequisite: TEST project par ye migrations pehle chali hon (aap khud, approval ke baad):
//      day-12-1, day-12-2, day-12-5, day-12-7, day-12-10, day-13-4, phase6-step4-part1-campaign-pricing, phase6-step4-part2-event-billing
//    Missing => before() hook batakar FAIL karta hai. Yahan se koi migration / schema change kabhi nahi chalta.
// !! Ye test ledger ko ON NAHI karta. Ledger band na mile toh test saaf FAIL hota hai (kuch likhe bina).
// !! Sirf TAG wali apni rows banata/hatata hai (apni ids se). Koi poori-table safai nahi, koi bina-filter DELETE nahi.
// !! Do jagah test-only SQL chalti hai (dono sirf TAG wale campaign par, aur ek transaction ke ROLLBACK me): ek bada spend row (numeric overflow se
//    settlement ko fail karwane ke liye) aur "expired hold" ki hath se bani rows. Production par kabhi nahi.
// !! Ye sandbox me CHALAYA NAHI gaya (Postgres / `pg` / network nahi). Pehli baar denim par khud chalao.

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type PgClient = { query: Q; release: () => void };
type PgPool = { query: Q; connect: () => Promise<PgClient>; end: () => Promise<void> };
type Json = Record<string, unknown>;
type Serve = { id: string; ref: string; campaignId: string; creativeId: string; publisherId: string };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it6s4p2_${randomBytes(4).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const DEST = "https://example.com/x";
const units = (v: unknown): number => Math.round(Number(v) * 10_000); // 1 unit = $0.0001 (float se bachne ke liye integer units)

describe("phase 6 step 4 part 2: event-based billing on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  const users = { pub1: randomUUID(), pub2: randomUUID(), adv: randomUUID() };
  const ids = { pub1: "", pub2: "", adv: "", hash1: "", hash2: "" };
  const campaigns: string[] = [];
  const creatives: string[] = [];

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 8 });
  }

  /** Function ek alag connection par, service_role me, apni transaction me (asli app jaisa). */
  async function callService<T>(sql: string, params: unknown[]): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const r = await client.query(sql, params);
      await client.query("commit");
      return r.rows[0].r as T;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  const impression = (ref: string, pub: string) => callService<Json>(`select public.record_ad_impression($1::text, $2::uuid) as r`, [ref, pub]);
  const click = (ref: string, pub: string, cr: string) => callService<Json>(`select public.record_ad_click($1::text, $2::uuid, $3::uuid) as r`, [ref, pub, cr]);
  const rawServe = (creativeId: string, hash: string = ids.hash1) => callService<Json>(`select public.record_ad_serve($1, $2::uuid, 'gaming') as r`, [hash, creativeId]);

  type Pricing = { model: "cpm" | "cpc" | null; rate?: string };
  async function makeCampaign(label: string, o: { total?: string; daily?: string | null; pricing?: Pricing } = {}): Promise<{ campaignId: string; creativeId: string }> {
    const pricing = o.pricing ?? { model: "cpm", rate: "2.00" };
    const c = await pool.query(
      `insert into public.campaigns (advertiser_id, name, category, total_budget, daily_budget, start_date, pricing_model, cpm_rate_usd, cpc_rate_usd)
       values ($1, $2, 'gaming', $3::numeric, $4::numeric, current_date - 5, $5, $6::numeric, $7::numeric) returning id`,
      [ids.adv, `${TAG}-${label}`, o.total ?? "100", o.daily ?? null, pricing.model, pricing.model === "cpm" ? pricing.rate : null, pricing.model === "cpc" ? pricing.rate : null],
    );
    const campaignId = String(c.rows[0].id);
    campaigns.push(campaignId);
    const cr = await pool.query(
      `insert into public.ad_creatives (campaign_id, headline, body, destination_url) values ($1, $2, 'Body', $3) returning id`,
      [campaignId, `${TAG}-${label}`, DEST],
    );
    const creativeId = String(cr.rows[0].id);
    creatives.push(creativeId);
    await pool.query(`update public.ad_creatives set status = 'approved', reviewed_at = now() where id = $1`, [creativeId]);
    await pool.query(`update public.campaigns set status = 'active' where id = $1`, [campaignId]);
    return { campaignId, creativeId };
  }

  async function serve(campaignId: string, creativeId: string, hash: string = ids.hash1): Promise<Serve> {
    const r = await rawServe(creativeId, hash);
    assert.equal(r.outcome, "ok", `fixture serve failed: ${String(r.outcome)}`);
    const row = (await pool.query(`select id, serve_ref from public.ad_serve_log where serve_ref = $1`, [r.serve_ref])).rows[0];
    return { id: String(row.id), ref: String(row.serve_ref), campaignId, creativeId, publisherId: hash === ids.hash1 ? ids.pub1 : ids.pub2 };
  }

  const spent = async (campaignId: string): Promise<number> =>
    units((await pool.query(`select coalesce(sum(spent), 0) as s from public.campaign_spend_daily where campaign_id = $1`, [campaignId])).rows[0].s);
  const held = async (campaignId: string): Promise<number> =>
    units((await pool.query(`select coalesce(sum(amount), 0) as s from public.ad_budget_reservations where campaign_id = $1 and status = 'held' and expires_at > now()`, [campaignId])).rows[0].s);
  const reservation = async (serveId: string): Promise<Row> => (await pool.query(`select * from public.ad_budget_reservations where serve_id = $1`, [serveId])).rows[0];
  const eventCount = async (serveId: string, type?: string): Promise<number> =>
    Number((await pool.query(`select count(*)::int as n from public.ad_events where serve_id = $1 and ($2::text is null or event_type = $2)`, [serveId, type ?? null])).rows[0].n);

  before(async () => {
    pool = await ensurePool();

    const need = await pool.query(
      `select
         (select array_agg(n) from unnest(array['record_ad_serve', 'record_ad_impression', 'record_ad_click', 'release_expired_budget_reservations']) n
            where not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = n)) as missing_fns,
         to_regclass('public.ad_events') as events_tbl,
         to_regclass('public.ad_budget_reservations') as res_tbl,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name in ('pricing_model', 'cpm_rate_usd', 'cpc_rate_usd')) as pricing_cols,
         (select ledger_enabled from public.ledger_settings where id) as ledger_on`,
    );
    const n = need.rows[0];
    const missing: string[] = [];
    if (Array.isArray(n.missing_fns)) missing.push(...(n.missing_fns as string[]).map((f) => `function ${f}`));
    if (!n.events_tbl) missing.push("table ad_events (day-12-2)");
    if (!n.res_tbl) missing.push("table ad_budget_reservations (phase6-step4-part2-event-billing)");
    if (Number(n.pricing_cols) !== 3) missing.push("campaign pricing columns (phase6-step4-part1-campaign-pricing)");
    if (missing.length > 0) {
      await pool.end();
      throw new Error(`PREREQUISITE MISSING on TEST DB: ${missing.join(", ")}. Apply the migrations on the TEST project yourself. Tests did not run; no SQL was executed.`);
    }
    if (n.ledger_on !== false) {
      await pool.end();
      throw new Error("Ledger is not disabled on this database (ledger_settings.ledger_enabled must be false). This test never enables or disables the ledger. Nothing was written.");
    }

    const mk = (id: string, role: string, label: string) =>
      pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, `${TAG}-${label}@example.test`, JSON.stringify({ role })]);
    await mk(users.pub1, "publisher", "pub1");
    await mk(users.pub2, "publisher", "pub2");
    await mk(users.adv, "advertiser", "adv");
    ids.pub1 = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, 'active') returning id`, [users.pub1, `${TAG}-pub1`])).rows[0].id);
    ids.pub2 = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, 'active') returning id`, [users.pub2, `${TAG}-pub2`])).rows[0].id);
    await pool.query(
      `insert into public.advertisers (profile_id, company_name, status) values ($1, $2, 'active')
       on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active'`,
      [users.adv, `${TAG}-advertiser`],
    );
    ids.adv = String((await pool.query(`select id from public.advertisers where profile_id = $1`, [users.adv])).rows[0].id);
    ids.hash1 = sha256(String((await pool.query(`select private.issue_publisher_key($1) as k`, [ids.pub1])).rows[0].k));
    ids.hash2 = sha256(String((await pool.query(`select private.issue_publisher_key($1) as k`, [ids.pub2])).rows[0].k));
  });

  after(async () => {
    if (!pool) return;
    if (!ids.pub1 && !ids.adv && campaigns.length === 0) {
      await pool.end().catch(() => undefined);
      return;
    }
    // Sirf TAG wali rows (apni ids se), FK ke ulte order me.
    const steps: [string, unknown[]][] = [
      [`delete from public.ad_events where campaign_id = any($1::uuid[])`, [campaigns]],
      [`delete from public.ad_budget_reservations where campaign_id = any($1::uuid[])`, [campaigns]],
      [`delete from public.ad_serve_requests where publisher_id = any($1::uuid[])`, [[ids.pub1, ids.pub2]]],
      [`delete from public.ad_serve_log where publisher_id = any($1::uuid[])`, [[ids.pub1, ids.pub2]]],
      [`delete from public.creative_serve_daily where creative_id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaign_spend_daily where campaign_id = any($1::uuid[])`, [campaigns]],
      [`delete from public.ad_creatives where id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaigns where id = any($1::uuid[])`, [campaigns]],
      [`delete from public.publisher_api_keys where publisher_id = any($1::uuid[])`, [[ids.pub1, ids.pub2]]],
      [`delete from public.publishers where id = any($1::uuid[])`, [[ids.pub1, ids.pub2]]],
      [`delete from public.advertisers where id = $1`, [ids.adv]],
      [`delete from auth.users where id = any($1::uuid[])`, [Object.values(users)]],
    ];
    for (const [sql, params] of steps) {
      try {
        await pool.query(sql, params);
      } catch (e) {
        console.error(`[integration cleanup] ${TAG}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await pool.end();
  });

  const unknownRef = () => `bsr_${randomBytes(20).toString("hex")}`;

  it("serving reserves budget but charges nothing: no spend row, no event, a held reservation with the trusted price", async () => {
    const { campaignId, creativeId } = await makeCampaign("serve-only");
    const s1 = await serve(campaignId, creativeId);
    await serve(campaignId, creativeId);
    await serve(campaignId, creativeId);
    assert.equal(await spent(campaignId), 0, "API response / serve never creates a charge");
    assert.equal(await held(campaignId), 3 * 20, "3 serves x $0.0020 held");
    assert.equal(await eventCount(s1.id), 0);
    const r = await reservation(s1.id);
    assert.equal(r.status, "held");
    assert.equal(r.pricing_model, "cpm");
    assert.equal(units(r.amount), 20);
    assert.equal(r.publisher_id, ids.pub1, "publisher comes from the API key, not from the caller");
    assert.equal(String(r.reserve_day), String((await pool.query(`select (now() at time zone 'utc')::date as d`)).rows[0].d));
  });

  it("CPM: first valid impression charges once; duplicate impression and any click are free", async () => {
    const { campaignId, creativeId } = await makeCampaign("cpm");
    const s = await serve(campaignId, creativeId);
    const a = await impression(s.ref, s.publisherId);
    assert.equal(a.outcome, "recorded");
    assert.equal(a.billed, true);
    assert.equal(await spent(campaignId), 20);
    assert.equal(await held(campaignId), 0, "hold turned into spend, not double counted");
    const b = await impression(s.ref, s.publisherId);
    assert.equal(b.outcome, "duplicate");
    assert.equal(b.billed, false);
    const c = await click(s.ref, s.publisherId, creativeId);
    assert.equal(c.outcome, "recorded");
    assert.equal(c.billed, false, "CPM click is never billed");
    const d = await click(s.ref, s.publisherId, creativeId);
    assert.equal(d.outcome, "duplicate");
    assert.equal(await spent(campaignId), 20);
    const r = await reservation(s.id);
    assert.equal(r.status, "settled");
    assert.equal(r.billed_event_type, "impression");
    assert.equal(await eventCount(s.id, "impression"), 1);
    assert.equal(await eventCount(s.id, "click"), 1);
  });

  it("CPC: impression is free, click before impression is not_counted, the first click after it charges the click rate once", async () => {
    const { campaignId, creativeId } = await makeCampaign("cpc", { pricing: { model: "cpc", rate: "0.0150" } });
    const s = await serve(campaignId, creativeId);
    assert.equal(units((await reservation(s.id)).amount), 150, "CPC reserves the click rate, not CPM/1000");
    const early = await click(s.ref, s.publisherId, creativeId);
    assert.equal(early.outcome, "not_counted");
    assert.equal(early.billed, false);
    assert.equal(await eventCount(s.id, "click"), 0);
    const imp = await impression(s.ref, s.publisherId);
    assert.equal(imp.outcome, "recorded");
    assert.equal(imp.billed, false, "CPC impression is free");
    assert.equal(await spent(campaignId), 0);
    const first = await click(s.ref, s.publisherId, creativeId);
    assert.equal(first.outcome, "recorded");
    assert.equal(first.billed, true);
    assert.equal(await spent(campaignId), 150);
    const again = await click(s.ref, s.publisherId, creativeId);
    assert.equal(again.outcome, "duplicate");
    assert.equal(again.billed, false);
    assert.equal(await spent(campaignId), 150);
    assert.equal((await reservation(s.id)).billed_event_type, "click");
  });

  it("CPC rate change after serve does not change the charge (price snapshot); campaigns without pricing use the platform CPM", async () => {
    const a = await makeCampaign("snapshot", { pricing: { model: "cpc", rate: "0.0150" } });
    const s = await serve(a.campaignId, a.creativeId);
    await impression(s.ref, s.publisherId);
    await pool.query(`update public.campaigns set cpc_rate_usd = 0.9000 where id = $1`, [a.campaignId]);
    await click(s.ref, s.publisherId, a.creativeId);
    assert.equal(await spent(a.campaignId), 150);

    const b = await makeCampaign("legacy-null", { pricing: { model: null } });
    const platform = Number((await pool.query(`select cpm_usd from public.ad_platform_settings where id`)).rows[0].cpm_usd);
    const s2 = await serve(b.campaignId, b.creativeId);
    await impression(s2.ref, s2.publisherId);
    assert.equal(await spent(b.campaignId), Math.max(Math.round((platform / 1000) * 10_000), 1));
  });

  it("invalid events never charge: unknown serve, wrong publisher, wrong creative, malformed ref", async () => {
    const { campaignId, creativeId } = await makeCampaign("invalid");
    const other = await makeCampaign("invalid-other");
    const s = await serve(campaignId, creativeId);
    assert.equal((await impression(unknownRef(), ids.pub1)).outcome, "rejected");
    assert.equal((await impression(s.ref, ids.pub2)).outcome, "rejected");
    assert.equal((await impression("not-a-ref", ids.pub1)).outcome, "rejected");
    assert.equal((await click(s.ref, ids.pub1, other.creativeId)).outcome, "rejected");
    assert.equal((await click(s.ref, ids.pub2, creativeId)).outcome, "rejected");
    assert.equal(await spent(campaignId), 0);
    assert.equal(await eventCount(s.id), 0);
    assert.equal((await reservation(s.id)).status, "held");
  });

  it("a paused campaign's click is ineligible (no click row, no charge)", async () => {
    const { campaignId, creativeId } = await makeCampaign("paused", { pricing: { model: "cpc", rate: "0.0150" } });
    const s = await serve(campaignId, creativeId);
    await impression(s.ref, s.publisherId);
    await pool.query(`update public.campaigns set status = 'paused' where id = $1`, [campaignId]);
    const r = await click(s.ref, s.publisherId, creativeId);
    assert.equal(r.outcome, "ineligible");
    assert.equal(await spent(campaignId), 0);
    assert.equal(await eventCount(s.id, "click"), 0);
  });

  it("legacy serve (no reservation row, charged at serve time before the migration) is never charged again by an event", async () => {
    const { campaignId, creativeId } = await makeCampaign("legacy-serve");
    const ins = await pool.query(
      `insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic) values ($1, $2, $3, 'gaming') returning id, serve_ref`,
      [ids.pub1, creativeId, campaignId],
    );
    const ref = String(ins.rows[0].serve_ref);
    const r = await impression(ref, ids.pub1);
    assert.equal(r.outcome, "recorded");
    assert.equal(r.billed, false);
    assert.equal(await spent(campaignId), 0);
  });

  it("expired events never charge: impression after 24h is rejected, and a CPC click after 24h is rejected", async () => {
    const a = await makeCampaign("expired-cpm");
    const s = await serve(a.campaignId, a.creativeId);
    await pool.query(`update public.ad_serve_log set served_at = now() - interval '25 hours' where id = $1`, [s.id]);
    assert.equal((await impression(s.ref, s.publisherId)).outcome, "rejected");
    assert.equal(await spent(a.campaignId), 0);
    assert.equal(await eventCount(s.id), 0);

    const b = await makeCampaign("expired-cpc", { pricing: { model: "cpc", rate: "0.0150" } });
    const t = await serve(b.campaignId, b.creativeId);
    await impression(t.ref, t.publisherId);
    await pool.query(`update public.ad_serve_log set served_at = now() - interval '25 hours' where id = $1`, [t.id]);
    assert.equal((await click(t.ref, t.publisherId, b.creativeId)).outcome, "rejected");
    assert.equal(await spent(b.campaignId), 0);
  });

  it("expired holds stop counting against the budget, are released on the next serve, and free the budget", async () => {
    const { campaignId, creativeId } = await makeCampaign("release", { total: "0.01", pricing: { model: "cpm", rate: "5.00" } }); // total_budget numeric(12,2): kam se kam 0.01; $0.0050/serve => sirf 2 serves
    // Hath se 2 purani (25h pehle ki) serves + unki expire ho chuki holds.
    for (let i = 0; i < 2; i += 1) {
      const sl = await pool.query(
        `insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at) values ($1, $2, $3, 'gaming', now() - interval '25 hours') returning id`,
        [ids.pub1, creativeId, campaignId],
      );
      await pool.query(
        `insert into public.ad_budget_reservations (serve_id, campaign_id, publisher_id, pricing_model, amount, reserve_day, reserved_at, expires_at)
         values ($1, $2, $3, 'cpm', 0.0050, ((now() - interval '25 hours') at time zone 'utc')::date, now() - interval '25 hours', now() - interval '1 hour')`,
        [sl.rows[0].id, campaignId, ids.pub1],
      );
    }
    assert.equal(await held(campaignId), 0, "expired holds do not count");
    const a = await serve(campaignId, creativeId);
    await serve(campaignId, creativeId);
    assert.equal((await rawServe(creativeId)).outcome, "rejected", "now 2 live holds fill the $0.01 budget");
    const left = await pool.query(`select count(*)::int as n from public.ad_budget_reservations where campaign_id = $1 and status = 'held' and expires_at <= now()`, [campaignId]);
    assert.equal(Number(left.rows[0].n), 0, "record_ad_serve released this campaign's expired holds");
    const rel = await callService<Json>(`select public.release_expired_budget_reservations(1000) as r`, []);
    assert.equal(rel.outcome, "ok");
    assert.equal((await reservation(a.id)).status, "held", "live holds are not touched by the bulk release");
    assert.equal(await spent(campaignId), 0);
  });

  it("budget exhaustion: parallel serves can never reserve more than the total budget (no impression needed)", async () => {
    const { campaignId, creativeId } = await makeCampaign("exhaust", { total: "0.0100" }); // 5 serves
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => rawServe(creativeId, i % 2 ? ids.hash1 : ids.hash2)));
    assert.equal(results.filter((r) => r.outcome === "ok").length, 5);
    assert.equal(results.filter((r) => r.outcome === "rejected").length, 15);
    assert.equal(await held(campaignId), 100);
    assert.equal(await spent(campaignId), 0);
  });

  it("budget exhaustion: settling every hold in parallel (each impression sent twice) lands exactly on the total budget, never above", async () => {
    const { campaignId, creativeId } = await makeCampaign("settle-all", { total: "0.0100" }); // 5 serves
    const refs: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await rawServe(creativeId);
      if (r.outcome === "ok") refs.push(String(r.serve_ref));
    }
    assert.equal(refs.length, 5, "only 5 serves fit the reserved budget");
    await Promise.all(refs.flatMap((ref) => [impression(ref, ids.pub1), impression(ref, ids.pub1)]));
    assert.equal(await spent(campaignId), 100, "exactly the total budget, charged once per serve");
    assert.equal(await held(campaignId), 0);
    assert.equal((await rawServe(creativeId)).outcome, "rejected", "budget exhausted: nothing more can be served");
  });

  it("daily budget: holds + spend of the same UTC day are limited by daily_budget", async () => {
    const { campaignId, creativeId } = await makeCampaign("daily", { total: "5.00", daily: "0.01", pricing: { model: "cpm", rate: "5.00" } }); // daily_budget numeric(12,2): 0.01; $0.0050/serve => 2 serves / din
    const a = await serve(campaignId, creativeId);
    await serve(campaignId, creativeId);
    assert.equal((await rawServe(creativeId)).outcome, "rejected");
    await impression(a.ref, a.publisherId); // hold -> spend: daily total same, phir bhi full
    assert.equal((await rawServe(creativeId)).outcome, "rejected");
    const day = (await pool.query(`select day, spent from public.campaign_spend_daily where campaign_id = $1`, [campaignId])).rows;
    assert.equal(day.length, 1);
    assert.equal(String(day[0].day), String((await reservation(a.id)).reserve_day), "spend is booked on the serve's UTC day");
  });

  it("lowering total_budget below spent + live holds is refused; exactly spent + holds is allowed", async () => {
    // total_budget numeric(12,2) hai, isliye bada rate (CPM 1000.00 => $1.0000 / serve) se spent + hold = $2.00 banta hai.
    const { campaignId, creativeId } = await makeCampaign("budget-edit", { total: "5.00", pricing: { model: "cpm", rate: "1000.00" } });
    const a = await serve(campaignId, creativeId);
    await serve(campaignId, creativeId);
    await impression(a.ref, a.publisherId); // spent 1.00 + held 1.00
    await assert.rejects(pool.query(`update public.campaigns set total_budget = 1.99 where id = $1`, [campaignId]), /pending reservations|budget/i);
    await pool.query(`update public.campaigns set total_budget = 2.00 where id = $1`, [campaignId]);
  });

  it("concurrency: the same impression sent 30 times at once records once and charges once", async () => {
    const { campaignId, creativeId } = await makeCampaign("conc-imp");
    const s = await serve(campaignId, creativeId);
    const rs = await Promise.all(Array.from({ length: 30 }, () => impression(s.ref, s.publisherId)));
    assert.equal(rs.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(rs.filter((r) => r.outcome === "duplicate").length, 29);
    assert.equal(rs.filter((r) => r.billed === true).length, 1);
    assert.equal(await spent(campaignId), 20);
    assert.equal(await eventCount(s.id, "impression"), 1);
  });

  it("concurrency: the same CPC click sent 30 times at once records once and charges once", async () => {
    const { campaignId, creativeId } = await makeCampaign("conc-click", { pricing: { model: "cpc", rate: "0.0150" } });
    const s = await serve(campaignId, creativeId);
    await impression(s.ref, s.publisherId);
    const rs = await Promise.all(Array.from({ length: 30 }, () => click(s.ref, s.publisherId, creativeId)));
    assert.equal(rs.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(rs.filter((r) => r.billed === true).length, 1);
    assert.equal(await spent(campaignId), 150);
  });

  it("serve + impression + click + retry mix in parallel keeps spend == settled reservations (no overspend)", async () => {
    const { campaignId, creativeId } = await makeCampaign("mix", { total: "0.0200" });
    const first = await serve(campaignId, creativeId);
    await Promise.all([
      ...Array.from({ length: 15 }, () => rawServe(creativeId)),
      ...Array.from({ length: 5 }, () => impression(first.ref, first.publisherId)),
    ]);
    const refs = (await pool.query(`select serve_ref from public.ad_serve_log where campaign_id = $1`, [campaignId])).rows.map((r) => String(r.serve_ref));
    await Promise.all(refs.map((ref) => impression(ref, ids.pub1)));
    const settled = units((await pool.query(`select coalesce(sum(amount), 0) as s from public.ad_budget_reservations where campaign_id = $1 and status = 'settled'`, [campaignId])).rows[0].s);
    assert.equal(await spent(campaignId), settled);
    assert.ok(settled <= 200, "never above the $0.0200 total budget");
  });

  it("rollback: if settlement fails, the impression event, the spend and the hold all roll back; a clean retry then charges", async () => {
    const { campaignId, creativeId } = await makeCampaign("rollback");
    const s = await serve(campaignId, creativeId);
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Spend row ko bhar do taaki settlement ka "spent + amount" numeric(12,4) se overflow ho (22003) => function fail hoga.
      await client.query(
        `insert into public.campaign_spend_daily (campaign_id, day, spent) values ($1, (now() at time zone 'utc')::date, 99999999.9999)
         on conflict (campaign_id, day) do update set spent = 99999999.9999`,
        [campaignId],
      );
      await client.query("savepoint attempt");
      await client.query("set local role service_role");
      await assert.rejects(client.query(`select public.record_ad_impression($1::text, $2::uuid)`, [s.ref, s.publisherId]), /out of range|overflow|numeric/i);
      await client.query("rollback to savepoint attempt");
      const ev = await client.query(`select count(*)::int as n from public.ad_events where serve_id = $1`, [s.id]);
      assert.equal(Number(ev.rows[0].n), 0, "event insert rolled back together with the failed charge");
      const rs = await client.query(`select status from public.ad_budget_reservations where serve_id = $1`, [s.id]);
      assert.equal(rs.rows[0].status, "held");
    } finally {
      await client.query("rollback").catch(() => undefined); // test ka bada spend row bhi gaya
      client.release();
    }
    assert.equal(await spent(campaignId), 0);
    const retry = await impression(s.ref, s.publisherId);
    assert.equal(retry.outcome, "recorded", "retry is NOT a duplicate because the failed attempt left no event");
    assert.equal(retry.billed, true);
    assert.equal(await spent(campaignId), 20);
  });

  it("rollback: an impression inside a caller transaction that is rolled back leaves no event, no spend, hold intact", async () => {
    const { campaignId, creativeId } = await makeCampaign("rollback-caller");
    const s = await serve(campaignId, creativeId);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const r = await client.query(`select public.record_ad_impression($1::text, $2::uuid) as r`, [s.ref, s.publisherId]);
      assert.equal((r.rows[0].r as Json).billed, true);
      await client.query("rollback");
    } finally {
      client.release();
    }
    assert.equal(await eventCount(s.id), 0);
    assert.equal(await spent(campaignId), 0);
    assert.equal((await reservation(s.id)).status, "held");
  });

  it("existing serve references and Idempotency-Key retry are preserved: same key => same serve_ref, one reservation, no extra hold", async () => {
    const { campaignId, creativeId } = await makeCampaign("idem");
    const key = `k_${randomBytes(8).toString("hex")}`;
    const call = () => callService<Json>(`select public.record_ad_serve($1, $2::uuid, 'gaming', $3) as r`, [ids.hash1, creativeId, key]);
    const a = await call();
    const b = await call();
    assert.equal(a.outcome, "ok");
    assert.equal(b.outcome, "ok");
    assert.equal(a.serve_ref, b.serve_ref);
    assert.match(String(a.serve_ref), /^bsr_[0-9a-f]{40}$/);
    const n = await pool.query(`select count(*)::int as n from public.ad_budget_reservations where campaign_id = $1`, [campaignId]);
    assert.equal(Number(n.rows[0].n), 1);
    assert.equal(await held(campaignId), 20);
    assert.equal(await spent(campaignId), 0);
  });

  it("ledger stays disabled and writes nothing for any of these serves / events", async () => {
    const on = await pool.query(`select ledger_enabled from public.ledger_settings where id`);
    assert.equal(on.rows[0].ledger_enabled, false);
    const refs = (await pool.query(`select serve_ref from public.ad_serve_log where campaign_id = any($1::uuid[])`, [campaigns])).rows.map((r) => String(r.serve_ref));
    assert.ok(refs.length > 0);
    const l = await pool.query(`select count(*)::int as n from public.financial_ledger where source_type = 'serve' and source_ref = any($1::text[])`, [refs]);
    assert.equal(Number(l.rows[0].n), 0);
  });

  it("the reservation table and the new functions are closed to app roles", async () => {
    const t = await pool.query(
      `select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'ad_budget_reservations' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
    );
    assert.equal(Number(t.rows[0].n), 0);
    for (const role of ["anon", "authenticated"]) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(`set local role ${role}`);
        await assert.rejects(client.query(`select public.record_ad_impression($1::text, $2::uuid)`, [unknownRef(), ids.pub1]), /permission denied/i);
        await client.query("rollback");
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    }
  });
});
