import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

// Day 9 Part 5: ASLI Postgres par integration test (record_ad_serve ka concurrency, retry-key, exhausted budget, paused/unapproved).
//
// !! Ye test SIRF alag TEST Supabase project par chalta hai. Production par kabhi nahi (guard: test-db-guard.ts).
// !! Bina in env ke ye poori file SKIP hoti hai (npm test normal chalta rehta hai):
//      TEST_DATABASE_URL=postgresql://postgres:...@db.<TEST-REF>.supabase.co:5432/postgres
//      TEST_SUPABASE_PROJECT_REF=<TEST-REF>
//      TEST_DB_CONFIRM=blisscco-test-db
//    Test project par pehle day-3 se day-9-7 tak ki migrations (supabase/sql) chali honi chahiye.
// !! Ye test sirf APNI banayi hui (tagged) rows banata aur hatata hai. Koi table khali nahi hota.
// !! Maine ye test is sandbox me CHALAYA NAHI (yahan Postgres/`pg` nahi hai). Pehli baar test project par khud chalao.

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  release?: () => void;
};
type PgPool = { query: PgClient["query"]; connect: () => Promise<PgClient & { release: () => void }>; end: () => Promise<void> };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;

const TAG = `it9p5_${randomBytes(4).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("day 9 part 5: record_ad_serve on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  let unitMicro = 0; // 1 serve ki keemat, micro-dollar (1e-4)
  const ids = { pubUser: randomUUID(), advUser: randomUUID(), publisher: "", advertiser: "", key: "", hash: "" };
  const campaigns: string[] = [];
  const creatives: string[] = [];

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg"; // dynamic: `pg` sirf integration run me chahiye
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 25 });
  }

  /** Ek naya campaign + approved creative banata hai (sirf tagged). */
  async function makeCampaign(label: string, opts: { total?: string; daily?: string | null; status?: string; creative?: string; endOffset?: number | null } = {}) {
    const total = opts.total ?? "0.01";
    const c = await pool.query(
      `insert into public.campaigns (advertiser_id, name, category, total_budget, daily_budget, start_date)
       values ($1, $2, 'gaming', $3, $4, current_date - 5) returning id`,
      [ids.advertiser, `${TAG}-${label}`, total, opts.daily ?? null],
    );
    const campaignId = String(c.rows[0].id);
    campaigns.push(campaignId);
    const cr = await pool.query(
      `insert into public.ad_creatives (campaign_id, headline, body, destination_url) values ($1, $2, 'Body', 'https://example.com/x') returning id`,
      [campaignId, `${TAG}-${label}`],
    );
    const creativeId = String(cr.rows[0].id);
    creatives.push(creativeId);
    await pool.query(`update public.ad_creatives set status = $2, reviewed_at = now() where id = $1`, [creativeId, opts.creative ?? "approved"]);
    await pool.query(`update public.campaigns set status = $2 where id = $1`, [campaignId, opts.status ?? "active"]);
    if (opts.endOffset !== undefined && opts.endOffset !== null) {
      await pool.query(`update public.campaigns set end_date = current_date + $2::int where id = $1`, [campaignId, opts.endOffset]);
    }
    return { campaignId, creativeId };
  }

  /** record_ad_serve ek alag connection par, service_role ke roop me (asli app jaisa), apni transaction me. */
  async function record(creativeId: string, idem?: string, hash: string = ids.hash): Promise<Record<string, unknown>> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const r =
        idem === undefined
          ? await client.query(`select public.record_ad_serve($1, $2::uuid, 'gaming') as r`, [hash, creativeId])
          : await client.query(`select public.record_ad_serve($1, $2::uuid, 'gaming', $3) as r`, [hash, creativeId, idem]);
      await client.query("commit");
      return r.rows[0].r as Record<string, unknown>;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  const spentMicro = async (campaignId: string) =>
    Math.round(Number((await pool.query(`select coalesce(sum(spent), 0) as s from public.campaign_spend_daily where campaign_id = $1`, [campaignId])).rows[0].s) * 10_000);
  const logRows = async (creativeId: string) => Number((await pool.query(`select count(*) as n from public.ad_serve_log where creative_id = $1`, [creativeId])).rows[0].n);
  const outcomes = (rs: Record<string, unknown>[]) => rs.map((r) => String(r.outcome));
  const count = (xs: string[], v: string) => xs.filter((x) => x === v).length;

  before(async () => {
    pool = await ensurePool();
    const cpm = Number((await pool.query(`select cpm_usd from public.ad_platform_settings limit 1`)).rows[0].cpm_usd);
    unitMicro = Math.ceil((cpm / 1000) * 10_000 - 1e-9);

    // Publisher + advertiser: auth.users insert -> signup trigger profile banata hai (role metadata se); advertiser row auto-active (day-4-1).
    await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"publisher"}'::jsonb)`, [ids.pubUser, `${TAG}-pub@example.test`]);
    await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"advertiser"}'::jsonb)`, [ids.advUser, `${TAG}-adv@example.test`]);
    ids.publisher = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, 'active') returning id`, [ids.pubUser, `${TAG}-publisher`])).rows[0].id);
    await pool.query(
      `insert into public.advertisers (profile_id, company_name, status) values ($1, $2, 'active')
       on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active'`,
      [ids.advUser, `${TAG}-advertiser`],
    );
    ids.advertiser = String((await pool.query(`select id from public.advertisers where profile_id = $1`, [ids.advUser])).rows[0].id);

    const key = String((await pool.query(`select private.issue_publisher_key($1) as k`, [ids.publisher])).rows[0].k);
    ids.hash = sha256(key);
  });

  after(async () => {
    if (!pool) return;
    // Sirf TAG wali rows, FK ke ulte order me. Kuch fail ho toh baaki cleanup chalta rehta hai.
    const steps: [string, unknown[]][] = [
      [`delete from public.ad_serve_requests where publisher_id = $1`, [ids.publisher]],
      [`delete from public.ad_serve_log where publisher_id = $1`, [ids.publisher]],
      [`delete from public.creative_serve_daily where creative_id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaign_spend_daily where campaign_id = any($1::uuid[])`, [campaigns]],
      [`delete from public.ad_creatives where id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaigns where id = any($1::uuid[])`, [campaigns]],
      [`delete from public.publisher_api_keys where publisher_id = $1`, [ids.publisher]],
      [`delete from public.publishers where id = $1`, [ids.publisher]],
      [`delete from public.advertisers where id = $1`, [ids.advertiser]],
      [`delete from auth.users where id = any($1::uuid[])`, [[ids.pubUser, ids.advUser]]],
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

  const fits = (totalDollars: number) => Math.floor(Math.round(totalDollars * 10_000) / unitMicro);

  it("20 concurrent serves, total budget 0.01 => exactly floor(0.01/unit) ok, rest rejected, spend never above total", async () => {
    const { campaignId, creativeId } = await makeCampaign("total", { total: "0.01" });
    const rs = await Promise.all(Array.from({ length: 20 }, () => record(creativeId)));
    const o = outcomes(rs);
    assert.equal(count(o, "ok"), fits(0.01));
    assert.equal(count(o, "ok") + count(o, "rejected"), 20, `unexpected outcomes: ${o.join(",")}`);
    assert.equal(await spentMicro(campaignId), fits(0.01) * unitMicro);
    assert.ok((await spentMicro(campaignId)) <= 100);
    assert.equal(await logRows(creativeId), fits(0.01));
  });

  it("20 concurrent serves, daily budget 0.01 (total 100) => daily limit enforced", async () => {
    const { campaignId, creativeId } = await makeCampaign("daily", { total: "100", daily: "0.01" });
    const rs = await Promise.all(Array.from({ length: 20 }, () => record(creativeId)));
    assert.equal(count(outcomes(rs), "ok"), fits(0.01));
    assert.equal(await spentMicro(campaignId), fits(0.01) * unitMicro);
  });

  it("the same Idempotency-Key from 10 concurrent requests is charged once; the rest get the same ad", async () => {
    const { campaignId, creativeId } = await makeCampaign("idem", { total: "100" });
    const key = `idem-${TAG}-1`;
    const rs = await Promise.all(Array.from({ length: 10 }, () => record(creativeId, key)));
    assert.deepEqual([...new Set(outcomes(rs))], ["ok"]);
    assert.equal(rs.filter((r) => r.replayed === true).length, 9);
    assert.equal(await spentMicro(campaignId), unitMicro);
    assert.equal(await logRows(creativeId), 1);
    assert.equal(Number((await pool.query(`select count(*) as n from public.ad_serve_requests where publisher_id = $1 and idempotency_key = $2`, [ids.publisher, key])).rows[0].n), 1);
  });

  it("a rejected request does not burn the key: after fixing the campaign the same key is served and charged once", async () => {
    const { campaignId, creativeId } = await makeCampaign("burn", { total: "100", status: "paused" });
    const key = `idem-${TAG}-2`;
    assert.equal((await record(creativeId, key)).outcome, "rejected");
    assert.equal(await spentMicro(campaignId), 0);
    await pool.query(`update public.campaigns set status = 'active' where id = $1`, [campaignId]);
    assert.equal((await record(creativeId, key)).outcome, "ok");
    assert.equal(await spentMicro(campaignId), unitMicro);
  });

  it("paused, unapproved (pending/rejected) and ended campaigns are rejected and never charged", async () => {
    const cases: [string, Parameters<typeof makeCampaign>[1]][] = [
      ["paused", { status: "paused" }],
      ["draft", { status: "draft" }],
      ["creative-pending", { creative: "pending_review" }],
      ["creative-rejected", { creative: "rejected" }],
      ["ended", { endOffset: -1 }],
    ];
    for (const [label, opts] of cases) {
      const { campaignId, creativeId } = await makeCampaign(label, { total: "100", ...opts });
      const r = await record(creativeId);
      assert.equal(r.outcome, "rejected", label);
      assert.equal(await spentMicro(campaignId), 0, label);
      assert.equal(await logRows(creativeId), 0, label);
    }
  });

  it("an unknown or malformed key hash is unauthorized and nothing is charged", async () => {
    const { campaignId, creativeId } = await makeCampaign("unauth", { total: "100" });
    assert.equal((await record(creativeId, undefined, sha256("not-a-real-key"))).outcome, "unauthorized");
    assert.equal((await record(creativeId, undefined, "xyz")).outcome, "unauthorized");
    assert.equal(await spentMicro(campaignId), 0);
  });

  it("the database itself refuses to write spend above the total (last wall), even when written directly", async () => {
    const { campaignId } = await makeCampaign("wall", { total: "0.01" });
    await assert.rejects(
      pool.query(`insert into public.campaign_spend_daily (campaign_id, day, spent) values ($1, (now() at time zone 'utc')::date, 0.0200)`, [campaignId]),
    );
    assert.equal(await spentMicro(campaignId), 0);
  });
});
