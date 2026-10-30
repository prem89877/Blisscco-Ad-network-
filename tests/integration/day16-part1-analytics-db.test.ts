import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

// Day 16 Part 1: Day 15 analytics functions ka ASLI Postgres test
// (public.get_my_campaign_analytics(uuid), public.get_my_publisher_analytics()).
//
// !! SIRF alag TEST Supabase project par (guard: test-db-guard.ts). Env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! Prerequisite: TEST project par day-3 .. day-12-12 migrations chali hon (migration yahan nahi chalti, schema nahi badalta).
// !! Sirf TAG wali apni rows banata/hatata hai. Credentials kabhi log nahi hote.
// !! Ye sandbox me CHALAYA NAHI gaya (Postgres / network nahi). Pehli baar TEST project par khud chalao.

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type PgClient = { query: Q; release: () => void };
type PgPool = { query: Q; connect: () => Promise<PgClient>; end: () => Promise<void> };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it16p1_${randomBytes(4).toString("hex")}`;

describe("day 16 part 1: analytics functions on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  let prereqMissing: string | null = null;

  const users = { adv1: randomUUID(), adv2: randomUUID(), pub1: randomUUID(), pub2: randomUUID(), pubNoRow: randomUUID(), pubSusp: randomUUID() };
  const ids = { adv1: "", adv2: "", pub1: "", pub2: "", pubSusp: "" };
  const camp = { a: "", zero: "", b: "", s: "" }; // a, zero => adv1 ; b, s => adv2
  const creatives: Record<string, string> = {};
  const allCampaigns: string[] = [];
  const allCreatives: string[] = [];
  const users_extra: string[] = []; // test ke andar bane extra users / publishers (cleanup ke liye)
  const extraPublishers: string[] = [];

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 5 });
  }

  /** Ek transaction, caller ke JWT + role ke saath (authenticated / anon / service_role). Hamesha rollback (sirf padhna). */
  async function asRole<T>(role: "authenticated" | "anon" | "service_role", sub: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const claims = sub ? { sub, role } : { role };
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await client.query(`set local role ${role}`);
      return await fn(client.query.bind(client));
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  const campaignRows = (sub: string | null, arg: string | null) =>
    asRole("authenticated", sub, async (q) => (await q("select * from public.get_my_campaign_analytics($1::uuid)", [arg])).rows);
  const publisherRows = (sub: string | null) =>
    asRole("authenticated", sub, async (q) => (await q("select * from public.get_my_publisher_analytics()")).rows);

  /** Insert ke liye (owner connection): ek serve + uske events. */
  async function addServe(publisherId: string, campaignId: string, types: ("serve" | "impression" | "click")[]) {
    const s = await pool.query(
      `insert into public.ad_serve_log (publisher_id, creative_id, campaign_id, topic, served_at) values ($1, $2, $3, 'gaming', now()) returning id`,
      [publisherId, creatives[campaignId], campaignId],
    );
    const serveId = String(s.rows[0].id);
    const source: Record<string, string> = { serve: "publisher_server", impression: "blisscco_beacon", click: "blisscco_redirect" };
    for (const t of types) {
      await pool.query(
        `insert into public.ad_events (serve_id, publisher_id, campaign_id, creative_id, event_type, source, occurred_at) values ($1, $2, $3, $4, $5, $6, now())`,
        [serveId, publisherId, campaignId, creatives[campaignId], t, source[t]],
      );
    }
  }

  async function makeCampaign(advertiserId: string, label: string): Promise<string> {
    const c = await pool.query(
      `insert into public.campaigns (advertiser_id, name, category, total_budget, start_date) values ($1, $2, 'gaming', 10, current_date - 1) returning id`,
      [advertiserId, `${TAG}-${label}`],
    );
    const id = String(c.rows[0].id);
    allCampaigns.push(id);
    const cr = await pool.query(
      `insert into public.ad_creatives (campaign_id, headline, body, destination_url) values ($1, $2, 'Body', 'https://example.com/x') returning id`,
      [id, `${TAG}-${label}`],
    );
    creatives[id] = String(cr.rows[0].id);
    allCreatives.push(creatives[id]);
    return id;
  }

  before(async () => {
    pool = await ensurePool();

    // Prerequisite check: migrations missing => report, schema kabhi nahi badalna.
    const fn = await pool.query(
      `select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_my_campaign_analytics', 'get_my_publisher_analytics')`,
    );
    const tbl = await pool.query(`select to_regclass('public.ad_events') as t`);
    if (Number(fn.rows[0].n) !== 2 || !tbl.rows[0].t) {
      prereqMissing = "Prerequisite missing on TEST DB: day-12-2 (ad_events) and day-12-12 (analytics functions) migrations must be applied first.";
      return;
    }

    // auth.users insert -> signup trigger profile banata hai (role metadata se).
    const mk = (id: string, role: string, label: string) =>
      pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, `${TAG}-${label}@example.test`, JSON.stringify({ role })]);
    await mk(users.adv1, "advertiser", "adv1");
    await mk(users.adv2, "advertiser", "adv2");
    await mk(users.pub1, "publisher", "pub1");
    await mk(users.pub2, "publisher", "pub2");
    await mk(users.pubNoRow, "publisher", "pubnorow"); // publisher profile, par publishers row nahi
    await mk(users.pubSusp, "publisher", "pubsusp");

    for (const [key, user] of [["adv1", users.adv1], ["adv2", users.adv2]] as const) {
      await pool.query(
        `insert into public.advertisers (profile_id, company_name, status) values ($1, $2, 'active')
         on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active'`,
        [user, `${TAG}-company-${key}`],
      );
      ids[key] = String((await pool.query(`select id from public.advertisers where profile_id = $1`, [user])).rows[0].id);
    }
    for (const [key, user] of [["pub1", users.pub1], ["pub2", users.pub2], ["pubSusp", users.pubSusp]] as const) {
      ids[key] = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, 'active') returning id`, [user, `${TAG}-${key}`])).rows[0].id);
    }
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [users.pubSusp]);

    camp.a = await makeCampaign(ids.adv1, "A");
    camp.zero = await makeCampaign(ids.adv1, "ZERO");
    camp.b = await makeCampaign(ids.adv2, "B");
    camp.s = await makeCampaign(ids.adv2, "S");

    // Campaign A: pub1 -> 3 impressions + 1 click (+1 serve-only, ginti me nahi); pub2 -> 1 impression.  => A: 4 imp / 1 click / ctr 25
    await addServe(ids.pub1, camp.a, ["impression", "click"]);
    await addServe(ids.pub1, camp.a, ["impression"]);
    await addServe(ids.pub1, camp.a, ["impression"]);
    await addServe(ids.pub1, camp.a, ["serve"]);
    await addServe(ids.pub2, camp.a, ["impression"]);
    // Campaign B (doosra advertiser): pub1 -> 2 imp + 2 click; pub2 -> 4 imp + 1 click.  => B: 6 imp / 3 click / ctr 50
    await addServe(ids.pub1, camp.b, ["impression", "click"]);
    await addServe(ids.pub1, camp.b, ["impression", "click"]);
    await addServe(ids.pub2, camp.b, ["impression", "click"]);
    await addServe(ids.pub2, camp.b, ["impression"]);
    await addServe(ids.pub2, camp.b, ["impression"]);
    await addServe(ids.pub2, camp.b, ["impression"]);
    // Campaign S: sirf suspended publisher ki traffic.
    await addServe(ids.pubSusp, camp.s, ["impression"]);
    // Campaign ZERO: koi event nahi.
    // Totals: pub1 = 5 imp / 3 click / ctr 60 ; pub2 = 5 imp / 1 click / ctr 20.
  });

  after(async () => {
    if (!pool) return;
    const steps: [string, unknown[]][] = [
      [`delete from public.ad_events where campaign_id = any($1::uuid[])`, [allCampaigns]],
      [`delete from public.ad_serve_log where campaign_id = any($1::uuid[])`, [allCampaigns]],
      [`delete from public.ad_creatives where id = any($1::uuid[])`, [allCreatives]],
      [`delete from public.campaigns where id = any($1::uuid[])`, [allCampaigns]],
      [`delete from public.publishers where id = any($1::uuid[])`, [[ids.pub1, ids.pub2, ids.pubSusp, ...extraPublishers].filter(Boolean)]],
      [`delete from public.advertisers where id = any($1::uuid[])`, [[ids.adv1, ids.adv2].filter(Boolean)]],
      [`delete from auth.users where id = any($1::uuid[])`, [[...Object.values(users), ...users_extra]]],
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

  const ready = (t: { skip: (m?: string) => void }) => {
    if (prereqMissing) {
      t.skip(prereqMissing);
      return false;
    }
    return true;
  };
  const num = (v: unknown) => Number(v);

  // ---------------- campaign analytics ----------------

  it("advertiser sees own campaign: impressions / clicks / CTR correct (serve-only events and other publishers' traffic counted correctly)", async (t) => {
    if (!ready(t)) return;
    const rows = await campaignRows(users.adv1, camp.a);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].campaign_id, camp.a);
    assert.equal(num(rows[0].impressions), 4);
    assert.equal(num(rows[0].clicks), 1);
    assert.equal(num(rows[0].ctr), 25);
  });

  it("advertiser list (null id) returns exactly own campaigns, never the other advertiser's", async (t) => {
    if (!ready(t)) return;
    const rows = await campaignRows(users.adv1, null);
    assert.deepEqual(rows.map((r) => String(r.campaign_id)).sort(), [camp.a, camp.zero].sort());
    const rows2 = await campaignRows(users.adv2, null);
    assert.deepEqual(rows2.map((r) => String(r.campaign_id)).sort(), [camp.b, camp.s].sort());
    const b = rows2.find((r) => r.campaign_id === camp.b)!;
    assert.deepEqual([num(b.impressions), num(b.clicks), num(b.ctr)], [6, 3, 50]);
  });

  it("another advertiser's campaign id => 0 rows (same as unknown id, no leak)", async (t) => {
    if (!ready(t)) return;
    assert.equal((await campaignRows(users.adv2, camp.a)).length, 0);
    assert.equal((await campaignRows(users.adv1, camp.b)).length, 0);
    assert.equal((await campaignRows(users.adv1, randomUUID())).length, 0);
  });

  it("zero-event campaign => 0 / 0 / ctr 0 (no division error)", async (t) => {
    if (!ready(t)) return;
    const rows = await campaignRows(users.adv1, camp.zero);
    assert.equal(rows.length, 1);
    assert.deepEqual([num(rows[0].impressions), num(rows[0].clicks), num(rows[0].ctr)], [0, 0, 0]);
  });

  it("CTR is rounded to 4 decimals (1 click / 3 impressions style data)", async (t) => {
    if (!ready(t)) return;
    const c = await makeCampaign(ids.adv1, "ROUND");
    await addServe(ids.pub1, c, ["impression", "click"]);
    await addServe(ids.pub1, c, ["impression"]);
    await addServe(ids.pub1, c, ["impression"]);
    const rows = await campaignRows(users.adv1, c);
    assert.deepEqual([num(rows[0].impressions), num(rows[0].clicks), num(rows[0].ctr)], [3, 1, 33.3333]);
  });

  it("publisher, publisher without a row, no-sub (auth.uid null) callers get no campaign analytics", async (t) => {
    if (!ready(t)) return;
    assert.equal((await campaignRows(users.pub1, null)).length, 0);
    assert.equal((await campaignRows(users.pub1, camp.a)).length, 0);
    assert.equal((await campaignRows(users.pubNoRow, null)).length, 0);
    assert.equal((await campaignRows(null, null)).length, 0); // authenticated role, par auth.uid() null
  });

  it("anon and service_role are denied on both functions (permission denied)", async (t) => {
    if (!ready(t)) return;
    for (const role of ["anon", "service_role"] as const) {
      for (const sql of ["select * from public.get_my_campaign_analytics(null)", "select * from public.get_my_publisher_analytics()"]) {
        await assert.rejects(
          asRole(role, null, (q) => q(sql)),
          (e: unknown) => (e as { code?: string }).code === "42501",
          `${role}: ${sql}`,
        );
      }
    }
  });

  // ---------------- publisher analytics ----------------

  it("publisher gets only own aggregate totals (impressions / clicks / CTR), isolated from other publishers", async (t) => {
    if (!ready(t)) return;
    const r1 = await publisherRows(users.pub1);
    assert.equal(r1.length, 1);
    assert.deepEqual([num(r1[0].impressions), num(r1[0].clicks), num(r1[0].ctr)], [5, 3, 60]);
    const r2 = await publisherRows(users.pub2);
    assert.equal(r2.length, 1);
    assert.deepEqual([num(r2[0].impressions), num(r2[0].clicks), num(r2[0].ctr)], [5, 1, 20]);
  });

  it("publisher result never exposes campaign or advertiser identity (columns + values)", async (t) => {
    if (!ready(t)) return;
    const rows = await publisherRows(users.pub1);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["clicks", "ctr", "impressions"]);
    const json = JSON.stringify(rows);
    for (const secret of [camp.a, camp.b, camp.zero, camp.s, ids.adv1, ids.adv2, users.adv1, users.adv2, TAG]) {
      assert.equal(json.includes(secret), false, "identity leaked in publisher analytics");
    }
  });

  it("zero-traffic active publisher still gets a 0 / 0 / 0 row; new tagged publisher has no foreign numbers", async (t) => {
    if (!ready(t)) return;
    const user = randomUUID();
    users_extra.push(user);
    await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"publisher"}'::jsonb)`, [user, `${TAG}-fresh@example.test`]);
    const pid = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, 'active') returning id`, [user, `${TAG}-fresh`])).rows[0].id);
    extraPublishers.push(pid);
    const rows = await publisherRows(user);
    assert.equal(rows.length, 1);
    assert.deepEqual([num(rows[0].impressions), num(rows[0].clicks), num(rows[0].ctr)], [0, 0, 0]);
  });

  it("missing publisher account, advertiser caller, suspended profile and no-JWT caller => 0 rows", async (t) => {
    if (!ready(t)) return;
    assert.equal((await publisherRows(users.pubNoRow)).length, 0); // profile hai, publishers row nahi
    assert.equal((await publisherRows(users.adv1)).length, 0);
    assert.equal((await publisherRows(users.pubSusp)).length, 0); // profile suspended, apni traffic ke bawajood
    assert.equal((await publisherRows(null)).length, 0);
    assert.equal((await publisherRows(randomUUID())).length, 0); // JWT sub jo kisi account ka nahi
  });
});
