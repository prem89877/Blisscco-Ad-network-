import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

// Day 16 Part 2: record_ad_impression(text, uuid) aur record_ad_click(text, uuid, uuid) ka ASLI Postgres test.
//
// !! SIRF alag TEST Supabase project par (guard: test-db-guard.ts). TEST env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! Prerequisite: TEST project par day-3 .. day-12-10 migrations chali hon. Env set hai par migration missing => before() hook
//    saaf message ke saath FAIL karta hai (koi PASS banaya nahi jaata, schema yahan se kabhi nahi badalta).
// !! Serves asli record_ad_serve se bante hain (service_role, day9 jaisa); events functions service_role se bulaye jaate hain.
// !! Sirf TAG wali apni rows banata/hatata hai: koi poori-table safai nahi, koi bina-filter DELETE nahi. Credentials kabhi log nahi hote.
// !! Ye sandbox me CHALAYA NAHI gaya (Postgres / `pg` / network nahi). Pehli baar TEST project par khud chalao.

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type PgClient = { query: Q; release: () => void };
type PgPool = { query: Q; connect: () => Promise<PgClient>; end: () => Promise<void> };
type Json = Record<string, unknown>;
type Serve = { ref: string; id: string; creativeId: string; campaignId: string };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it16p2_${randomBytes(4).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const DEST = "https://example.com/x";

describe("day 16 part 2: impression and click tracking on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  const users = { pub1: randomUUID(), pub2: randomUUID(), adv: randomUUID() };
  const ids = { pub1: "", pub2: "", adv: "", hash1: "", hash2: "" };
  const campaigns: string[] = [];
  const creatives: string[] = [];
  let cr1 = ""; // pub1 ke serves ke liye creative (campaign 1)
  let cr2 = ""; // doosre campaign ka creative (mismatch tests)
  let servedCount = 0;

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 15 });
  }

  /** Function ek alag connection par, diye gaye role me, apni transaction me (asli app jaisa: service_role). */
  async function callAs<T>(role: "service_role" | "anon" | "authenticated", sql: string, params: unknown[]): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
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
  const impression = (ref: unknown, pub: unknown) => callAs<Json>("service_role", `select public.record_ad_impression($1::text, $2::uuid) as r`, [ref, pub]);
  const click = (ref: unknown, pub: unknown, cr: unknown) => callAs<Json>("service_role", `select public.record_ad_click($1::text, $2::uuid, $3::uuid) as r`, [ref, pub, cr]);

  async function makeCampaign(label: string): Promise<{ campaignId: string; creativeId: string }> {
    const c = await pool.query(
      `insert into public.campaigns (advertiser_id, name, category, total_budget, start_date) values ($1, $2, 'gaming', 100, current_date - 5) returning id`,
      [ids.adv, `${TAG}-${label}`],
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

  /** Ek asli serve (record_ad_serve, billing ke saath) aur uski serve_ref. */
  async function serve(creativeId: string, campaignId: string, hash: string = ids.hash1): Promise<Serve> {
    const r = await callAs<Json>("service_role", `select public.record_ad_serve($1, $2::uuid, 'gaming') as r`, [hash, creativeId]);
    assert.equal(r.outcome, "ok", `fixture serve failed: ${String(r.outcome)}`);
    servedCount++;
    const publisherId = hash === ids.hash1 ? ids.pub1 : ids.pub2;
    const s = await pool.query(`select id, serve_ref from public.ad_serve_log where publisher_id = $1 and creative_id = $2 order by id desc limit 1`, [publisherId, creativeId]);
    return { ref: String(s.rows[0].serve_ref), id: String(s.rows[0].id), creativeId, campaignId };
  }

  const eventRows = async (serveId: string, type?: string) =>
    (await pool.query(`select * from public.ad_events where serve_id = $1 and ($2::text is null or event_type = $2) order by id`, [serveId, type ?? null])).rows;
  const countOf = async (serveId: string, type: string) => (await eventRows(serveId, type)).length;

  /** Billing / budget / serve-record ki poori tasveer (sirf is test ke campaigns / publishers). */
  async function billingSnapshot(): Promise<Json> {
    const one = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows;
    return {
      spend: await one(`select campaign_id, day, spent from public.campaign_spend_daily where campaign_id = any($1::uuid[]) order by campaign_id, day`, [campaigns]),
      serveDaily: await one(`select creative_id, day, serves from public.creative_serve_daily where creative_id = any($1::uuid[]) order by creative_id, day`, [creatives]),
      serveLog: await one(`select id, publisher_id, creative_id, campaign_id, topic, served_at, serve_ref from public.ad_serve_log where publisher_id = any($1::uuid[]) order by id`, [[ids.pub1, ids.pub2]]),
      campaigns: await one(`select to_jsonb(c) as row from public.campaigns c where c.id = any($1::uuid[]) order by c.id`, [campaigns]),
    } as unknown as Json;
  }

  before(async () => {
    pool = await ensurePool();

    // Prerequisites: missing => saaf FAIL (fabricated pass nahi).
    const need = await pool.query(
      `select
         (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('record_ad_impression', 'record_ad_click', 'record_ad_serve')) as fns,
         to_regclass('public.ad_events') as events_tbl,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'ad_serve_log' and column_name = 'serve_ref') as ref_col`,
    );
    const n = need.rows[0];
    if (Number(n.fns) < 3 || !n.events_tbl || Number(n.ref_col) !== 1) {
      await pool.end();
      throw new Error(
        "PREREQUISITE MISSING on TEST DB: apply day-12-1 (serve_ref), day-12-2 (ad_events), day-12-7 (record_ad_impression), day-12-10 (record_ad_click) and the earlier record_ad_serve migrations. Tests did not run.",
      );
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

    cr1 = (await makeCampaign("one")).creativeId;
    cr2 = (await makeCampaign("two")).creativeId;
  });

  after(async () => {
    if (!pool) return;
    // Sirf TAG wali rows (apni ids se), FK ke ulte order me.
    const steps: [string, unknown[]][] = [
      [`delete from public.ad_events where campaign_id = any($1::uuid[])`, [campaigns]],
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

  // ---------------- impression ----------------

  it("first impression is recorded (one beacon event, ids attributed from the serve), a retry is duplicate and adds no row", async () => {
    const s = await serve(cr1, campaigns[0]);
    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "recorded" });
    const rows = await eventRows(s.id, "impression");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "blisscco_beacon");
    assert.equal(rows[0].publisher_id, ids.pub1);
    assert.equal(rows[0].creative_id, cr1);
    assert.equal(rows[0].campaign_id, campaigns[0]);

    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "duplicate" });
    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "duplicate" });
    assert.equal(await countOf(s.id, "impression"), 1);
  });

  it("10 concurrent impressions for one serve => exactly 1 recorded, 9 duplicate, 1 row", async () => {
    const s = await serve(cr1, campaigns[0]);
    const rs = await Promise.all(Array.from({ length: 10 }, () => impression(s.ref, ids.pub1)));
    assert.equal(rs.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(rs.filter((r) => r.outcome === "duplicate").length, 9);
    assert.equal(await countOf(s.id, "impression"), 1);
  });

  it("invalid, unknown or mismatched references are rejected and write nothing", async () => {
    const s = await serve(cr1, campaigns[0]);
    const upper = `bsr_${s.ref.slice(4).toUpperCase()}`;
    const bad: [string, unknown, unknown][] = [
      ["null ref", null, ids.pub1],
      ["empty ref", "", ids.pub1],
      ["garbage ref", "xyz", ids.pub1],
      ["short ref", s.ref.slice(0, 20), ids.pub1],
      ["uppercase hex ref", upper, ids.pub1],
      ["no prefix ref", s.ref.slice(4), ids.pub1],
      ["null publisher", s.ref, null],
      ["unknown valid-format ref", unknownRef(), ids.pub1],
      ["other publisher's serve", s.ref, ids.pub2],
      ["random publisher id", s.ref, randomUUID()],
    ];
    for (const [label, ref, pub] of bad) {
      assert.deepEqual(await impression(ref, pub), { outcome: "rejected" }, label);
    }
    assert.equal(await countOf(s.id, "impression"), 0);
  });

  it("a serve older than 24 hours is rejected", async () => {
    const s = await serve(cr1, campaigns[0]);
    await pool.query(`update public.ad_serve_log set served_at = now() - interval '25 hours' where id = $1`, [s.id]);
    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "rejected" });
    assert.equal(await countOf(s.id, "impression"), 0);
  });

  it("anon and authenticated cannot execute the tracking functions (permission denied)", async () => {
    const s = await serve(cr1, campaigns[0]);
    for (const role of ["anon", "authenticated"] as const) {
      await assert.rejects(
        callAs(role, `select public.record_ad_impression($1::text, $2::uuid) as r`, [s.ref, ids.pub1]),
        (e: unknown) => (e as { code?: string }).code === "42501",
        `${role} impression`,
      );
      await assert.rejects(
        callAs(role, `select public.record_ad_click($1::text, $2::uuid, $3::uuid) as r`, [s.ref, ids.pub1, cr1]),
        (e: unknown) => (e as { code?: string }).code === "42501",
        `${role} click`,
      );
    }
    assert.equal((await eventRows(s.id)).length, 0);
  });

  // ---------------- click ----------------

  it("click before any impression is not_counted (destination returned, no click row)", async () => {
    const s = await serve(cr1, campaigns[0]);
    assert.deepEqual(await click(s.ref, ids.pub1, cr1), { outcome: "not_counted", destination_url: DEST });
    assert.equal(await countOf(s.id, "click"), 0);
  });

  it("first click after an impression is recorded, repeats are duplicate (destination always returned)", async () => {
    const s = await serve(cr1, campaigns[0]);
    await impression(s.ref, ids.pub1);
    assert.deepEqual(await click(s.ref, ids.pub1, cr1), { outcome: "recorded", destination_url: DEST });
    const rows = await eventRows(s.id, "click");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "blisscco_redirect");
    assert.equal(rows[0].publisher_id, ids.pub1);
    assert.equal(rows[0].creative_id, cr1);
    assert.equal(rows[0].campaign_id, campaigns[0]);

    assert.deepEqual(await click(s.ref, ids.pub1, cr1), { outcome: "duplicate", destination_url: DEST });
    assert.equal(await countOf(s.id, "click"), 1);
    assert.equal(await countOf(s.id, "impression"), 1);
  });

  it("10 concurrent clicks for one serve => exactly 1 recorded, 9 duplicate, 1 row", async () => {
    const s = await serve(cr1, campaigns[0]);
    await impression(s.ref, ids.pub1);
    const rs = await Promise.all(Array.from({ length: 10 }, () => click(s.ref, ids.pub1, cr1)));
    assert.equal(rs.filter((r) => r.outcome === "recorded").length, 1);
    assert.equal(rs.filter((r) => r.outcome === "duplicate").length, 9);
    assert.equal(await countOf(s.id, "click"), 1);
  });

  it("invalid serve, publisher or creative combinations are rejected and write no click", async () => {
    const s = await serve(cr1, campaigns[0]);
    await impression(s.ref, ids.pub1);
    const bad: [string, unknown, unknown, unknown][] = [
      ["null ref", null, ids.pub1, cr1],
      ["garbage ref", "xyz", ids.pub1, cr1],
      ["unknown valid-format ref", unknownRef(), ids.pub1, cr1],
      ["null publisher", s.ref, null, cr1],
      ["null creative", s.ref, ids.pub1, null],
      ["other publisher", s.ref, ids.pub2, cr1],
      ["creative of another campaign", s.ref, ids.pub1, cr2],
      ["random creative id", s.ref, ids.pub1, randomUUID()],
    ];
    for (const [label, ref, pub, cr] of bad) {
      assert.deepEqual(await click(ref, pub, cr), { outcome: "rejected" }, label);
    }
    assert.equal(await countOf(s.id, "click"), 0);
  });

  it("a serve older than 24 hours cannot be clicked (rejected)", async () => {
    const s = await serve(cr1, campaigns[0]);
    await impression(s.ref, ids.pub1);
    await pool.query(`update public.ad_serve_log set served_at = now() - interval '25 hours' where id = $1`, [s.id]);
    assert.deepEqual(await click(s.ref, ids.pub1, cr1), { outcome: "rejected" });
    assert.equal(await countOf(s.id, "click"), 0);
  });

  it("click on a campaign that is no longer active is ineligible and records nothing", async () => {
    const { campaignId, creativeId } = await makeCampaign("paused-later");
    const s = await serve(creativeId, campaignId);
    await impression(s.ref, ids.pub1);
    await pool.query(`update public.campaigns set status = 'paused' where id = $1`, [campaignId]);
    assert.deepEqual(await click(s.ref, ids.pub1, creativeId), { outcome: "ineligible" });
    assert.equal(await countOf(s.id, "click"), 0);
  });

  // ---------------- billing / spend untouched ----------------

  it("impression and click tracking never change spend, budget or serve billing records", async () => {
    const s = await serve(cr1, campaigns[0]); // serve ka charge yahin lagta hai (fixture); uske BAAD ki tasveer
    const snapBefore = await billingSnapshot();
    assert.ok((snapBefore.serveLog as unknown[]).length >= 1, "snapshot must see serve records");

    await impression(s.ref, ids.pub1);
    await impression(s.ref, ids.pub1); // duplicate
    await impression("xyz", ids.pub1); // rejected
    await click(s.ref, ids.pub1, cr1);
    await click(s.ref, ids.pub1, cr1); // duplicate
    await click(s.ref, ids.pub2, cr1); // rejected

    const snapAfter = await billingSnapshot();
    assert.deepEqual(snapAfter, snapBefore);
    assert.ok(servedCount > 0);
  });
});
