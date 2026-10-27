import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

// Day 10 Part 5: publisher auth + rate limit + retry-key isolation ka ASLI SQL test (authorize_publisher_key, record_ad_serve 4-arg,
// find_idempotent_serve). Nakli-database tests (tests/ads/day10-part5-integration.test.ts) Node ka raasta check karte hain;
// ye file SQL ke rules khud check karti hai.
//
// !! SIRF alag TEST Supabase project par (guard: test-db-guard.ts). Env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! Sirf TAG wali apni rows banati/hatati hai. Production credential kahin nahi.
// !! Ye sandbox me CHALAYI NAHI GAYI (Postgres / `pg` / network nahi). Pehli baar TEST project par chalao.

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
type PgClient = { query: Q; release: () => void };
type PgPool = { query: Q; connect: () => Promise<PgClient>; end: () => Promise<void> };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it10p5_${randomBytes(4).toString("hex")}`;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("day 10 part 5: publisher auth, rate limit and retry-key isolation on a real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  const userIds: string[] = [];
  const publisherIds: string[] = [];
  const campaigns: string[] = [];
  const creatives: string[] = [];
  let advertiserId = "";
  let advUser = "";
  let creativeId = "";
  let limit = 60;

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 5 });
  }

  /** Service-role ke roop me rpc (asli app jaisa). */
  async function rpc(fn: string, args: unknown[]): Promise<Record<string, unknown>> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const marks = args.map((_, i) => `$${i + 1}`).join(", ");
      const r = await client.query(`select public.${fn}(${marks}) as r`, args);
      await client.query("commit");
      return r.rows[0].r as Record<string, unknown>;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async function makePublisher(status: "pending" | "active" | "suspended", profileStatus: "active" | "suspended" = "active") {
    const user = randomUUID();
    userIds.push(user);
    await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"publisher"}'::jsonb)`, [user, `${TAG}-${user.slice(0, 6)}@example.test`]);
    if (profileStatus !== "active") await pool.query(`update public.profiles set status = $2 where id = $1`, [user, profileStatus]);
    const id = String((await pool.query(`insert into public.publishers (profile_id, name, status) values ($1, $2, $3) returning id`, [user, `${TAG}-pub`, status])).rows[0].id);
    publisherIds.push(id);
    const key = String((await pool.query(`select private.issue_publisher_key($1) as k`, [id])).rows[0].k);
    return { id, key, hash: sha256(key) };
  }

  before(async () => {
    pool = await ensurePool();
    limit = Number((await pool.query(`select rate_limit_per_minute as l from public.ad_platform_settings limit 1`)).rows[0]?.l ?? 60);

    advUser = randomUUID();
    userIds.push(advUser);
    await pool.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"advertiser"}'::jsonb)`, [advUser, `${TAG}-adv@example.test`]);
    await pool.query(
      `insert into public.advertisers (profile_id, company_name, status) values ($1, $2, 'active')
       on conflict (profile_id) do update set company_name = excluded.company_name, status = 'active'`,
      [advUser, `${TAG}-advertiser`],
    );
    advertiserId = String((await pool.query(`select id from public.advertisers where profile_id = $1`, [advUser])).rows[0].id);
    const c = await pool.query(
      `insert into public.campaigns (advertiser_id, name, category, total_budget, start_date) values ($1, $2, 'gaming', 5, current_date - 5) returning id`,
      [advertiserId, `${TAG}-campaign`],
    );
    campaigns.push(String(c.rows[0].id));
    const cr = await pool.query(`insert into public.ad_creatives (campaign_id, headline, body, destination_url) values ($1, $2, 'Body', 'https://example.com/x') returning id`, [campaigns[0], `${TAG}-creative`]);
    creativeId = String(cr.rows[0].id);
    creatives.push(creativeId);
    await pool.query(`update public.ad_creatives set status = 'approved', reviewed_at = now() where id = $1`, [creativeId]);
    await pool.query(`update public.campaigns set status = 'active' where id = $1`, [campaigns[0]]);
  });

  after(async () => {
    if (!pool) return;
    const steps: [string, unknown[]][] = [
      [`delete from public.ad_serve_requests where publisher_id = any($1::uuid[])`, [publisherIds]],
      [`delete from public.ad_serve_log where publisher_id = any($1::uuid[])`, [publisherIds]],
      [`delete from public.api_rate_limits where key_id in (select id from public.publisher_api_keys where publisher_id = any($1::uuid[]))`, [publisherIds]],
      [`delete from public.creative_serve_daily where creative_id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaign_spend_daily where campaign_id = any($1::uuid[])`, [campaigns]],
      [`delete from public.ad_creatives where id = any($1::uuid[])`, [creatives]],
      [`delete from public.campaigns where id = any($1::uuid[])`, [campaigns]],
      [`delete from public.publisher_api_keys where publisher_id = any($1::uuid[])`, [publisherIds]],
      [`delete from public.publishers where id = any($1::uuid[])`, [publisherIds]],
      [`delete from public.advertisers where id = $1`, [advertiserId]],
      [`delete from auth.users where id = any($1::uuid[])`, [userIds]],
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

  it("active publisher with an active key is authorized with its own publisher id", async () => {
    const p = await makePublisher("active");
    const r = await rpc("authorize_publisher_key", [p.hash]);
    assert.equal(r.outcome, "ok");
    assert.equal(r.publisher_id, p.id);
  });

  it("pending and suspended publishers, and a suspended profile, are unauthorized (same outcome as an unknown key)", async () => {
    const unknown = await rpc("authorize_publisher_key", [sha256(`${TAG}-nobody`)]);
    assert.equal(unknown.outcome, "unauthorized");
    for (const [status, profile] of [["pending", "active"], ["suspended", "active"], ["active", "suspended"]] as const) {
      const p = await makePublisher(status, profile);
      assert.deepEqual(await rpc("authorize_publisher_key", [p.hash]), unknown, `${status}/${profile}`);
      assert.deepEqual(await rpc("find_idempotent_serve", [p.hash, "retry-key-0001"]), { outcome: "unauthorized" });
      assert.equal((await rpc("record_ad_serve", [p.hash, creativeId, "gaming", "retry-key-0001"])).outcome, "unauthorized");
    }
  });

  it("revoked and expired keys are unauthorized; status change applies at once", async () => {
    const p = await makePublisher("active");
    assert.equal((await rpc("authorize_publisher_key", [p.hash])).outcome, "ok");
    await pool.query(`update public.publisher_api_keys set status = 'revoked', revoked_at = now() where key_hash = $1`, [p.hash]);
    assert.equal((await rpc("authorize_publisher_key", [p.hash])).outcome, "unauthorized");

    const e = await makePublisher("active");
    await pool.query(`update public.publisher_api_keys set expires_at = now() - interval '1 minute' where key_hash = $1`, [e.hash]);
    assert.equal((await rpc("authorize_publisher_key", [e.hash])).outcome, "unauthorized");

    const s = await makePublisher("active");
    await pool.query(`update public.publishers set status = 'suspended' where id = $1`, [s.id]);
    assert.equal((await rpc("authorize_publisher_key", [s.hash])).outcome, "unauthorized");
    await pool.query(`update public.publishers set status = 'active' where id = $1`, [s.id]);
    assert.equal((await rpc("authorize_publisher_key", [s.hash])).outcome, "ok");
  });

  it("malformed hashes are unauthorized without error", async () => {
    for (const h of ["", "not-a-hash", "A".repeat(64), "a".repeat(63)]) assert.equal((await rpc("authorize_publisher_key", [h])).outcome, "unauthorized", h);
  });

  it("rate limit is per key: the (limit+1)th call in a minute is rate_limited, another publisher is unaffected", async () => {
    const a = await makePublisher("active");
    const b = await makePublisher("active");
    const minute = async () => String((await pool.query(`select date_trunc('minute', now()) as m`)).rows[0].m);
    const startMinute = await minute();
    const outcomes: string[] = [];
    for (let i = 0; i < limit + 2; i++) outcomes.push(String((await rpc("authorize_publisher_key", [a.hash])).outcome));
    if ((await minute()) === startMinute) {
      // poora loop ek hi minute me hua: exactly `limit` ok, baaki 2 rate_limited
      assert.deepEqual(outcomes.slice(0, limit), Array(limit).fill("ok"));
      assert.deepEqual(outcomes.slice(limit), ["rate_limited", "rate_limited"]);
    } else {
      // minute badal gaya (window reset): sirf itna ki outcome ok ya rate_limited hi hain; test dobara chalao toh strict check hoga
      assert.ok(outcomes.every((o) => o === "ok" || o === "rate_limited"));
    }
    assert.equal((await rpc("authorize_publisher_key", [b.hash])).outcome, "ok");
  });

  it("Idempotency-Key is scoped per publisher: B cannot replay or even see A's retry key", async () => {
    const a = await makePublisher("active");
    const b = await makePublisher("active");
    const idem = `iso-${randomBytes(6).toString("hex")}`;
    assert.equal((await rpc("record_ad_serve", [a.hash, creativeId, "gaming", idem])).outcome, "ok");
    const aReplay = await rpc("find_idempotent_serve", [a.hash, idem]);
    assert.equal(aReplay.outcome, "found");
    assert.deepEqual(await rpc("find_idempotent_serve", [b.hash, idem]), { outcome: "none" });
    const bFirst = await rpc("record_ad_serve", [b.hash, creativeId, "gaming", idem]);
    assert.equal(bFirst.outcome, "ok");
    assert.notEqual(bFirst.replayed, true, "B is a fresh serve, not a replay of A");
    const logs = await pool.query(`select publisher_id, count(*)::int as n from public.ad_serve_log where publisher_id = any($1::uuid[]) group by 1`, [[a.id, b.id]]);
    const byPublisher = Object.fromEntries(logs.rows.map((r) => [String(r.publisher_id), Number(r.n)]));
    assert.equal(byPublisher[a.id], 1);
    assert.equal(byPublisher[b.id], 1);
  });

  it("the same retry key from the same publisher is charged only once", async () => {
    const a = await makePublisher("active");
    const idem = `once-${randomBytes(6).toString("hex")}`;
    const first = await rpc("record_ad_serve", [a.hash, creativeId, "gaming", idem]);
    const second = await rpc("record_ad_serve", [a.hash, creativeId, "gaming", idem]);
    assert.equal(first.outcome, "ok");
    assert.equal(second.replayed, true);
    const n = Number((await pool.query(`select count(*) as n from public.ad_serve_log where publisher_id = $1`, [a.id])).rows[0].n);
    assert.equal(n, 1);
  });
});
