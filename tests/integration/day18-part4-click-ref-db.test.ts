import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";
import { mintClickRef, verifyClickRefForServe, type ClickRefCheck, type ClickServeLookup } from "@/lib/ads/click-ref";
import { parseClickLookup } from "@/lib/ads/click-db";
import { readTrackingConfig, type TrackingConfig } from "@/lib/ads/tracking-token";

// Day 18 Part 4: signed bc1 click reference (mintClickRef / verifyClickRefForServe) + ASLI public.lookup_serve_for_click ka Postgres test.
//
// !! SIRF alag TEST Supabase project par (guard: test-db-guard.ts). TEST env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! Prerequisite: TEST project par Day 12 tracking SQL (day-12-1, day-12-2, day-12-7, day-12-10) + record_ad_serve chali ho.
//    Missing => before() hook missing cheezein batakar FAIL karta hai. Yahan se koi SQL / migration / schema change kabhi nahi chalta.
// !! Signing secret sirf is test ke liye random banta hai (memory me), koi env/production secret nahi. Koi secret/URL/ref log nahi hota.
// !! Serves asli record_ad_serve se bante hain; impression/click asli record_ad_impression / record_ad_click se (service_role).
// !! Sirf TAG wali apni rows banata/hatata hai: koi poori-table safai nahi, koi bina-filter DELETE nahi.
// !! Ye sandbox me CHALAYA NAHI gaya (Postgres / `pg` / network nahi). Pehli baar TEST project par khud chalao.

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type PgClient = { query: Q; release: () => void };
type PgPool = { query: Q; connect: () => Promise<PgClient>; end: () => Promise<void> };
type Json = Record<string, unknown>;
type Serve = { ref: string; id: string; creativeId: string; campaignId: string; publisherId: string; servedAtMs: number };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it18p4_${randomBytes(4).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const DEST = "https://example.com/x";

const reasonOf = (r: ClickRefCheck): string => (r.ok ? "ok" : r.reason);

describe("day 18 part 4: signed click reference vs real lookup_serve_for_click on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  const users = { pub1: randomUUID(), pub2: randomUUID(), adv: randomUUID() };
  const ids = { pub1: "", pub2: "", adv: "", hash1: "", hash2: "" };
  const campaigns: string[] = [];
  const creatives: string[] = [];
  let cr1 = ""; // pub1 ke serves ka creative (campaign 1)
  let cr2 = ""; // doosre campaign ka creative (mismatch tests)

  // Test-only secret: har run me naya, sirf memory me.
  const secret = randomBytes(32).toString("hex");
  const config = readTrackingConfig({ AD_TRACKING_SECRET: secret }) as TrackingConfig;

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 5 });
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
  const lookupRaw = (ref: string) => callService<Json>(`select public.lookup_serve_for_click($1::text) as r`, [ref]);

  /** ASLI database lookup (public.lookup_serve_for_click) -> verifyClickRefForServe ka lookupServe. */
  const lookupServe: ClickServeLookup = async (ref) => {
    const row = parseClickLookup(await lookupRaw(ref));
    return row ? { publisherId: row.publisherId, creativeId: row.creativeId, servedAtMs: row.servedAtMs } : null;
  };

  const verify = (ref: string, cfg: TrackingConfig = config, claimedCreativeId?: string) =>
    verifyClickRefForServe(ref, { config: cfg, nowMs: Date.now(), lookupServe, claimedCreativeId });

  /** Click ref banata hai; serve ka samay database ke serve row se (ad_serve_log.served_at). */
  function mint(s: { ref: string; servedAtMs: number }, publisherId: string, creativeId: string): string {
    const grant = mintClickRef(config, { serveRef: s.ref, publisherId, creativeId, servedAtMs: s.servedAtMs, nowMs: Date.now() });
    assert.ok(grant, "click ref could not be minted (check DB vs local clock difference)");
    return grant.ref;
  }

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

  /** Ek asli serve (record_ad_serve, billing ke saath) aur uski serve_ref + database ka served_at. */
  async function serve(creativeId: string, campaignId: string, hash: string = ids.hash1): Promise<Serve> {
    const r = await callService<Json>(`select public.record_ad_serve($1, $2::uuid, 'gaming') as r`, [hash, creativeId]);
    assert.equal(r.outcome, "ok", `fixture serve failed: ${String(r.outcome)}`);
    const publisherId = hash === ids.hash1 ? ids.pub1 : ids.pub2;
    const s = await pool.query(
      `select id, serve_ref, served_at from public.ad_serve_log where publisher_id = $1 and creative_id = $2 order by id desc limit 1`,
      [publisherId, creativeId],
    );
    return {
      ref: String(s.rows[0].serve_ref),
      id: String(s.rows[0].id),
      creativeId,
      campaignId,
      publisherId,
      servedAtMs: new Date(s.rows[0].served_at as string | Date).getTime(),
    };
  }

  const eventRows = async (serveId: string, type?: string) =>
    (await pool.query(`select * from public.ad_events where serve_id = $1 and ($2::text is null or event_type = $2) order by id`, [serveId, type ?? null])).rows;
  const countOf = async (serveId: string, type: string) => (await eventRows(serveId, type)).length;

  /** Billing / budget / serve-record ki poori tasveer (sirf is test ke campaigns / publishers). Digest se compare: failure me values print nahi hoti. */
  async function billingDigest(): Promise<string> {
    const one = async (sql: string, p: unknown[]) => (await pool.query(sql, p)).rows;
    const snap = {
      spend: await one(`select campaign_id, day, spent from public.campaign_spend_daily where campaign_id = any($1::uuid[]) order by campaign_id, day`, [campaigns]),
      serveDaily: await one(`select creative_id, day, serves from public.creative_serve_daily where creative_id = any($1::uuid[]) order by creative_id, day`, [creatives]),
      serveLog: await one(`select id, publisher_id, creative_id, campaign_id, topic, served_at, serve_ref from public.ad_serve_log where publisher_id = any($1::uuid[]) order by id`, [[ids.pub1, ids.pub2]]),
      campaigns: await one(`select to_jsonb(c) as row from public.campaigns c where c.id = any($1::uuid[]) order by c.id`, [campaigns]),
    };
    assert.ok(snap.serveLog.length >= 1, "snapshot must see serve records");
    return sha256(JSON.stringify(snap));
  }

  before(async () => {
    pool = await ensurePool();
    assert.ok(config, "test-only tracking config could not be created");

    // Prerequisites (Day 12 tracking SQL): missing => saaf FAIL, koi SQL nahi chalta.
    const need = await pool.query(
      `select
         (select array_agg(n) from unnest(array['record_ad_serve', 'record_ad_impression', 'record_ad_click', 'lookup_serve_for_click']) n
            where not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = n)) as missing_fns,
         to_regclass('public.ad_events') as events_tbl,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'ad_serve_log' and column_name = 'serve_ref') as ref_col`,
    );
    const n = need.rows[0];
    const missing: string[] = [];
    if (Array.isArray(n.missing_fns)) missing.push(...(n.missing_fns as string[]).map((f) => `function ${f}`));
    if (!n.events_tbl) missing.push("table ad_events (day-12-2)");
    if (Number(n.ref_col) !== 1) missing.push("column ad_serve_log.serve_ref (day-12-1)");
    if (missing.length > 0) {
      await pool.end();
      throw new Error(
        `PREREQUISITE MISSING on TEST DB: ${missing.join(", ")}. Apply day-12-1, day-12-2, day-12-7, day-12-10 and the earlier record_ad_serve migrations on the TEST project yourself. Tests did not run; no SQL was executed.`,
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
    // Sirf TAG wali rows (apni ids se), FK ke ulte order me. Prerequisite fail hua toh pool pehle hi band hai aur ids khali hain.
    if (!ids.pub1 && !ids.adv && campaigns.length === 0) {
      await pool.end().catch(() => undefined);
      return;
    }
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

  it("a signed bc1 reference verifies against the real lookup_serve_for_click row (same publisher, creative and serve)", async () => {
    const s = await serve(cr1, campaigns[0]);

    // Asli database lookup: sirf padhta hai, publisher/creative/serve_ref wahi, destination database se.
    const raw = await lookupRaw(s.ref);
    assert.equal(raw.outcome, "found");
    assert.equal(raw.publisher_id, ids.pub1);
    assert.equal(raw.creative_id, cr1);
    assert.equal(raw.destination_url, DEST);
    assert.equal(raw.eligible, true);

    const ref = mint(s, ids.pub1, cr1);
    assert.ok(ref.startsWith("bc1."));
    // Payload me destination nahi hona chahiye (destination sirf database se aata hai).
    const payload = Buffer.from(ref.split(".")[1], "base64url").toString("utf8");
    assert.equal(payload.includes(DEST), false);

    const checked = await verify(ref);
    assert.equal(reasonOf(checked), "ok");
    if (checked.ok) {
      assert.equal(checked.serveRef, s.ref);
      assert.equal(checked.publisherId, ids.pub1);
      assert.equal(checked.creativeId, cr1);
    }
    // Caller ka bataya hua sahi creative bhi chalta hai.
    assert.equal(reasonOf(await verify(ref, config, cr1)), "ok");

    // Sirf verify/lookup: koi event nahi likha gaya.
    assert.equal((await eventRows(s.id)).length, 0);
  });

  it("a reference with an invalid signature is rejected (wrong secret, forged signature, tampered payload)", async () => {
    const s = await serve(cr1, campaigns[0]);
    const ref = mint(s, ids.pub1, cr1);
    const [prefix, payloadB64, sigB64] = ref.split(".");

    // 1) Doosre (random) secret se verify.
    const otherConfig = readTrackingConfig({ AD_TRACKING_SECRET: randomBytes(32).toString("hex") }) as TrackingConfig;
    assert.equal(reasonOf(await verify(ref, otherConfig)), "invalid_signature");

    // 2) Signature badli hui (sahi lambai, sahi encoding).
    const forged = `${prefix}.${payloadB64}.${randomBytes(32).toString("base64url")}`;
    assert.notEqual(forged, ref);
    assert.equal(reasonOf(await verify(forged)), "invalid_signature");

    // 3) Payload me ek akshar badla, purani signature.
    const flipped = payloadB64[5] === "A" ? "B" : "A";
    const tampered = `${prefix}.${payloadB64.slice(0, 5)}${flipped}${payloadB64.slice(6)}.${sigB64}`;
    assert.equal(reasonOf(await verify(tampered)), "invalid_signature");

    assert.equal((await eventRows(s.id)).length, 0);
  });

  it("a reference minted for another publisher or creative is rejected against the database serve row; unknown serve too", async () => {
    const s = await serve(cr1, campaigns[0]);

    // Ref publisher 2 ke liye bana, par serve (database me) publisher 1 ka hai.
    assert.equal(reasonOf(await verify(mint(s, ids.pub2, cr1))), "publisher_mismatch");
    // Ref doosre campaign ke creative ke liye bana.
    assert.equal(reasonOf(await verify(mint(s, ids.pub1, cr2))), "creative_mismatch");
    // Sahi ref, par caller ne galat creative bataya.
    assert.equal(reasonOf(await verify(mint(s, ids.pub1, cr1), config, cr2)), "creative_mismatch");
    // Sahi ref, par caller ne random creative bataya.
    assert.equal(reasonOf(await verify(mint(s, ids.pub1, cr1), config, randomUUID())), "creative_mismatch");

    // Doosre publisher ka asli serve, par ref publisher 1 ke naam par.
    const other = await serve(cr1, campaigns[0], ids.hash2);
    assert.equal(reasonOf(await verify(mint(other, ids.pub1, cr1))), "publisher_mismatch");
    // Aur uska apna ref theek chalta hai.
    assert.equal(reasonOf(await verify(mint(other, ids.pub2, cr1))), "ok");

    // Database me na hone wala (valid-format) serve.
    const ghost = { ref: unknownRef(), servedAtMs: Date.now() };
    assert.equal(reasonOf(await verify(mint(ghost, ids.pub1, cr1))), "unknown_serve");

    assert.equal((await eventRows(s.id)).length, 0);
    assert.equal((await eventRows(other.id)).length, 0);
  });

  it("after an impression: first click is recorded, repeats are duplicate, the database-verified destination never changes", async () => {
    const s = await serve(cr1, campaigns[0]);
    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "recorded" });

    const ref = mint(s, ids.pub1, cr1);
    const destBefore = (await lookupRaw(s.ref)).destination_url;
    assert.equal(destBefore, DEST);

    // Verify -> database se aaye publisher/creative se click likho (caller ke diye se nahi).
    const checked = await verify(ref, config, cr1);
    assert.equal(reasonOf(checked), "ok");
    assert.ok(checked.ok);
    const first = await click(checked.serveRef, checked.publisherId, checked.creativeId);
    assert.deepEqual(first, { outcome: "recorded", destination_url: DEST });

    const rows = await eventRows(s.id, "click");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "blisscco_redirect");
    assert.equal(rows[0].publisher_id, ids.pub1);
    assert.equal(rows[0].creative_id, cr1);
    assert.equal(rows[0].campaign_id, campaigns[0]);

    // Wahi ref dobara verify hota hai (click se ref "use" nahi hota); repeated clicks duplicate.
    for (let i = 0; i < 2; i += 1) {
      const again = await verify(ref, config, cr1);
      assert.equal(reasonOf(again), "ok");
      assert.ok(again.ok);
      assert.deepEqual(await click(again.serveRef, again.publisherId, again.creativeId), { outcome: "duplicate", destination_url: DEST });
    }
    assert.equal(await countOf(s.id, "click"), 1);
    assert.equal(await countOf(s.id, "impression"), 1);

    // Destination database se wahi, ref/click ke baad bhi.
    const after = await lookupRaw(s.ref);
    assert.equal(after.destination_url, destBefore);
    assert.equal(after.eligible, true);
  });

  it("click reference verification and click tracking never change serve billing, campaign spend or budget", async () => {
    const s = await serve(cr1, campaigns[0]); // serve ka charge yahin lagta hai (fixture)
    assert.deepEqual(await impression(s.ref, ids.pub1), { outcome: "recorded" });
    const before = await billingDigest(); // click se pehle (serve + impression ke BAAD) ki tasveer

    const ref = mint(s, ids.pub1, cr1);
    const checked = await verify(ref, config, cr1);
    assert.equal(reasonOf(checked), "ok");
    assert.ok(checked.ok);
    assert.equal((await click(checked.serveRef, checked.publisherId, checked.creativeId)).outcome, "recorded");
    assert.equal((await click(checked.serveRef, checked.publisherId, checked.creativeId)).outcome, "duplicate");
    assert.equal(reasonOf(await verify(mint(s, ids.pub2, cr1))), "publisher_mismatch"); // reject: kuch nahi likhta
    assert.equal((await click(s.ref, ids.pub2, cr1)).outcome, "rejected"); // database bhi mismatch reject karta hai

    assert.equal(await countOf(s.id, "click"), 1);
    assert.equal(await billingDigest(), before, "click tracking changed spend, budget or serve billing records");
  });
});
