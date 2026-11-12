import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { checkTestDatabase } from "./test-db-guard";

type Row = Record<string, unknown>;
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type PgPool = { query: Q; connect: () => Promise<{ query: Q; release: () => void }>; end: () => Promise<void> };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;
const TAG = `it6s4p3_${randomBytes(4).toString("hex")}`;

describe("phase 6 step 4 part 3: pilot limits DB guard on real TEST database", { skip: skipReason }, () => {
  let pool: PgPool;
  const userAdv = randomUUID();
  let advId = "";
  const campaigns: string[] = [];

  before(async () => {
    const moduleName = "pg"; // dynamic: `pg` sirf integration run me chahiye (types ki zaroorat nahi)
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    pool = new Pool({ connectionString: guard.ok ? guard.url : "", max: 8 });

    await pool.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"role":"advertiser"}'::jsonb)`,
      [userAdv, `${TAG}@example.test`],
    );
    // handle_new_user (day-4-1) role=advertiser par advertiser row khud bana deta hai => pehle wahi dhoondo, warna insert.
    const existing = await pool.query(`select id from public.advertisers where profile_id = $1`, [userAdv]);
    if (existing.rows.length > 0) {
      advId = String(existing.rows[0].id);
      await pool.query(`update public.advertisers set company_name = $2, status = 'active' where id = $1`, [advId, `${TAG}-adv`]);
    } else {
      const r = await pool.query(
        `insert into public.advertisers (profile_id, company_name, status) values ($1, $2, 'active') returning id`,
        [userAdv, `${TAG}-adv`],
      );
      advId = String(r.rows[0].id);
    }
  });

  after(async () => {
    if (!pool) return;
    try {
      if (campaigns.length > 0) {
        await pool.query(`delete from public.campaigns where id = any($1::uuid[])`, [campaigns]);
      }
      if (advId) {
        await pool.query(`delete from public.advertisers where id = $1`, [advId]);
        await pool.query(`delete from auth.users where id = $1`, [userAdv]);
      }
    } catch (e) {
      console.error("[cleanup] error", e);
    }
    await pool.end();
  });

  it("direct insert of campaign with total_budget > 1000 is refused with hint pilot_campaign_limit", async () => {
    await assert.rejects(
      pool.query(
        `insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
         values ($1, 'Oversized', 'technology', 1000.01, current_date)`,
        [advId],
      ),
      (err: { hint?: string; code?: string }) => {
        return err.hint === "pilot_campaign_limit" && err.code === "23514";
      },
    );
  });

  it("30 parallel inserts for same advertiser never exceed $2000 total", async () => {
    const attempts = Array.from({ length: 30 }, (_, i) =>
      pool.query(
        `insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
         values ($1, $2, 'technology', 100.00, current_date) returning id`,
        [advId, `${TAG}-c-${i}`],
      ),
    );

    const outcomes = await Promise.allSettled(attempts);
    for (const o of outcomes) {
      if (o.status === "fulfilled") {
        campaigns.push(String(o.value.rows[0].id));
      }
    }

    const sumRes = await pool.query(
      `select sum(total_budget)::numeric as total from public.campaigns where advertiser_id = $1`,
      [advId],
    );
    const total = Number(sumRes.rows[0].total);
    assert.ok(total <= 2000.0, `Total budget exceeded $2000: ${total}`);
  });
});
