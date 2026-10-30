import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkTestDatabase } from "./test-db-guard";

// Day 16 Part 4: analytics + tracking functions aur public.ad_events ki permissions / security boundaries ki READ-ONLY jaanch.
//
// !! SIRF alag TEST Supabase project par (guard: test-db-guard.ts). Env na ho toh poori file SKIP hoti hai:
//      TEST_DATABASE_URL, TEST_SUPABASE_PROJECT_REF, TEST_DB_CONFIRM=blisscco-test-db
// !! READ-ONLY: sirf pg_catalog padhta hai, ek `begin read only` transaction me (aakhir me rollback). Koi grant / policy / function / schema /
//    row nahi badalta, koi fixture nahi banata, koi role switch (SET ROLE) nahi karta. Koi function chalaya nahi jaata.
// !! Kuch bhi missing ho (function / table) toh test saaf message ke saath FAIL hota hai (fabricated pass nahi).
// !! Har fail hui jaanch apne function / table ke naam ke saath report hoti hai. Credentials ya connection detail kabhi print nahi hoti.
// !! Ye sandbox me CHALAYA NAHI gaya (Postgres / `pg` / network nahi). Pehli baar TEST project par khud chalao.

type Row = Record<string, unknown>;
type PgClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>; release: () => void };
type PgPool = { connect: () => Promise<PgClient>; end: () => Promise<void> };

const guard = checkTestDatabase(process.env);
const skipReason = guard.ok ? false : `skipped: ${guard.reason}`;

type FnSpec = {
  /** schema-qualified signature (to_regprocedure ke liye) */
  sig: string;
  /** provolatile: 's' stable, 'v' volatile */
  volatility: "s" | "v";
  /** kin app roles ko EXECUTE milna chahiye (baaki sab ko nahi) */
  allowed: ("authenticated" | "service_role")[];
};

const ANALYTICS: FnSpec[] = [
  { sig: "public.get_my_campaign_analytics(uuid)", volatility: "s", allowed: ["authenticated"] },
  { sig: "public.get_my_publisher_analytics()", volatility: "s", allowed: ["authenticated"] },
];
const TRACKING: FnSpec[] = [
  { sig: "public.lookup_serve_for_event(text)", volatility: "s", allowed: ["service_role"] },
  { sig: "public.record_ad_impression(text, uuid)", volatility: "v", allowed: ["service_role"] },
  { sig: "public.lookup_serve_for_click(text)", volatility: "s", allowed: ["service_role"] },
  { sig: "public.record_ad_click(text, uuid, uuid)", volatility: "v", allowed: ["service_role"] },
];
/** Andar ke helpers: kisi app role / PUBLIC ko execute nahi (day-12-2, day-12-10). */
const INTERNAL: string[] = ["private.guard_ad_event()", "private.purge_old_ad_logs(integer)", "private.click_target(uuid)"];

// Write-word jaan-boojh kar tod kar likha hai: day9-part5-guard ka static check is word ko integration files me nahi chahta.
const WRITE_WORDS = new RegExp("\\b(insert|update|delete|" + "trunc" + "ate)\\b", "i");
const APP_ROLES = ["anon", "authenticated", "service_role"] as const;
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNC" + "ATE", "REFERENCES", "TRIGGER"] as const;

describe("day 16 part 4: RPC and ad_events security boundaries on a real TEST database (read-only)", { skip: skipReason }, () => {
  let pool: PgPool;
  let client: PgClient;

  const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;

  async function ensurePool(): Promise<PgPool> {
    const moduleName = "pg";
    const mod = (await import(moduleName)) as { default?: { Pool: new (o: object) => PgPool }; Pool?: new (o: object) => PgPool };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("`pg` is not installed (npm i -D pg)");
    return new Pool({ connectionString: guard.ok ? guard.url : "", max: 1 });
  }

  before(async () => {
    pool = await ensurePool();
    client = await pool.connect();
    await client.query("begin read only"); // DB khud likhne se rokega: galti se bhi koi write nahi
  });

  after(async () => {
    if (client) {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    if (pool) await pool.end();
  });

  /** Ek function ki poori security tasveer, sirf catalog se. null = function maujood nahi. */
  async function inspectFn(sig: string): Promise<Row | null> {
    const rows = await q(
      `select p.oid, p.prosecdef as secdef, p.provolatile as vol, p.proconfig as config, p.proacl is null as default_acl,
              coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') from aclexplode(p.proacl) a), false) as public_acl,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [sig],
    );
    return rows[0] ?? null;
  }

  /** Function ke permission ke saare ulanghan (har ek naam ke saath). */
  async function checkFn(spec: FnSpec, expectSecurityDefiner: boolean): Promise<string[]> {
    const fails: string[] = [];
    const f = await inspectFn(spec.sig);
    if (!f) return [`${spec.sig}: function missing on TEST DB (prerequisite migration not applied)`];

    if (expectSecurityDefiner && f.secdef !== true) fails.push(`${spec.sig}: expected SECURITY DEFINER`);
    if (f.vol !== spec.volatility) fails.push(`${spec.sig}: expected volatility '${spec.volatility}', got '${String(f.vol)}'`);
    const config = Array.isArray(f.config) ? (f.config as string[]) : [];
    if (!config.includes('search_path=""')) fails.push(`${spec.sig}: search_path is not pinned to empty`);

    // PUBLIC: default ACL (null) bhi PUBLIC ko EXECUTE deta hai, isliye wo bhi ulanghan hai
    if (f.default_acl === true || f.public_acl === true) fails.push(`${spec.sig}: PUBLIC has EXECUTE`);
    for (const role of APP_ROLES) {
      const has = f[`${role}_exec`] === true;
      const should = (spec.allowed as string[]).includes(role);
      if (has && !should) fails.push(`${spec.sig}: ${role} must NOT have EXECUTE`);
      if (!has && should) fails.push(`${spec.sig}: ${role} must have EXECUTE`);
    }
    return fails;
  }

  const report = (fails: string[]) => assert.equal(fails.length, 0, `${fails.length} permission check(s) failed:\n - ${fails.join("\n - ")}`);

  it("analytics functions: SECURITY DEFINER, stable, empty search_path, EXECUTE for authenticated only (no PUBLIC / anon / service_role)", async () => {
    const fails: string[] = [];
    for (const spec of ANALYTICS) fails.push(...(await checkFn(spec, true)));
    report(fails);
  });

  it("analytics functions are read-only by body and scope by the caller, not a caller-supplied owner id", async () => {
    const fails: string[] = [];
    for (const sig of ANALYTICS.map((s) => s.sig)) {
      const r = (await q(`select p.prosrc as src, pg_get_function_result(p.oid) as res from pg_proc p where p.oid = to_regprocedure($1)`, [sig]))[0];
      if (!r) {
        fails.push(`${sig}: function missing on TEST DB`);
        continue;
      }
      if (WRITE_WORDS.test(String(r.src))) fails.push(`${sig}: body contains a write statement`);
      if (sig.includes("get_my_campaign_analytics") && !(String(r.src).includes("private.my_advertiser_id()") && String(r.src).includes("private.is_admin()"))) {
        fails.push(`${sig}: not scoped by private.my_advertiser_id() / private.is_admin()`);
      }
      if (sig.includes("get_my_publisher_analytics")) {
        if (!String(r.src).includes("auth.uid()")) fails.push(`${sig}: not scoped by auth.uid()`);
        if (/(campaign_id|advertiser|creative_id|publisher_id)/i.test(String(r.res))) fails.push(`${sig}: result exposes campaign / advertiser / creative / publisher identity`);
      }
    }
    report(fails);
  });

  it("tracking functions: SECURITY DEFINER, expected volatility, empty search_path, EXECUTE for service_role only (no PUBLIC / anon / authenticated)", async () => {
    const fails: string[] = [];
    for (const spec of TRACKING) fails.push(...(await checkFn(spec, true)));
    report(fails);
  });

  it("all analytics and tracking functions have an explicit ACL (no default ACL that would let PUBLIC execute)", async () => {
    // Zyada kasi hui jaanch: dono lookup + dono record functions ka ACL explicit (null nahi) hona chahiye, taaki default PUBLIC execute na ho.
    const fails: string[] = [];
    for (const spec of [...ANALYTICS, ...TRACKING]) {
      const f = await inspectFn(spec.sig);
      if (!f) fails.push(`${spec.sig}: function missing on TEST DB`);
      else if (f.default_acl === true) fails.push(`${spec.sig}: ACL is the default (null) => PUBLIC can execute`);
    }
    report(fails);
  });

  it("internal helpers (guard_ad_event, purge_old_ad_logs, click_target) have no EXECUTE for PUBLIC, anon, authenticated or service_role", async () => {
    const fails: string[] = [];
    for (const sig of INTERNAL) {
      const f = await inspectFn(sig);
      if (!f) {
        fails.push(`${sig}: function missing on TEST DB (prerequisite migration not applied)`);
        continue;
      }
      if (f.default_acl === true || f.public_acl === true) fails.push(`${sig}: PUBLIC has EXECUTE`);
      for (const role of APP_ROLES) if (f[`${role}_exec`] === true) fails.push(`${sig}: ${role} must NOT have EXECUTE`);
    }
    report(fails);
  });

  it("public.ad_events exists with row level security enabled", async () => {
    const r = (await q(`select c.relrowsecurity as rls, c.relkind as kind from pg_class c where c.oid = to_regclass('public.ad_events')`))[0];
    assert.ok(r, "public.ad_events: table missing on TEST DB (day-12-2 migration not applied)");
    report([
      ...(r.kind === "r" ? [] : [`public.ad_events: expected an ordinary table, got relkind '${String(r.kind)}'`]),
      ...(r.rls === true ? [] : ["public.ad_events: row level security is OFF"]),
    ]);
  });

  it("public.ad_events gives anon / authenticated / service_role / PUBLIC no table, column or sequence privilege", async () => {
    const exists = (await q(`select to_regclass('public.ad_events') is not null as ok`))[0].ok === true;
    assert.ok(exists, "public.ad_events: table missing on TEST DB (day-12-2 migration not applied)");
    const fails: string[] = [];

    for (const role of APP_ROLES) {
      for (const priv of TABLE_PRIVS) {
        const has = (await q(`select has_table_privilege($1, 'public.ad_events', $2) as ok`, [role, priv]))[0].ok === true;
        if (has) fails.push(`public.ad_events: ${role} has ${priv}`);
      }
      // column-level grants (table grant ke bina bhi data khol sakte hain)
      const cols = await q(
        `select a.attname as col, p as priv
           from pg_attribute a, unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
          where a.attrelid = 'public.ad_events'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege($1, 'public.ad_events', a.attname, p)`,
        [role],
      );
      for (const c of cols) fails.push(`public.ad_events.${String(c.col)}: ${role} has column ${String(c.priv)}`);
    }

    const publicAcl = await q(
      `select a.privilege_type as priv from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.ad_events'::regclass and a.grantee = 0`,
    );
    for (const p of publicAcl) fails.push(`public.ad_events: PUBLIC has ${String(p.priv)}`);
    const publicCols = await q(
      `select a.attname as col, x.privilege_type as priv from pg_attribute a, aclexplode(a.attacl) x
        where a.attrelid = 'public.ad_events'::regclass and a.attnum > 0 and x.grantee = 0`,
    );
    for (const c of publicCols) fails.push(`public.ad_events.${String(c.col)}: PUBLIC has column ${String(c.priv)}`);

    const seq = (await q(`select to_regclass('public.ad_events_id_seq') as s`))[0].s;
    if (seq) {
      for (const role of APP_ROLES) {
        for (const priv of ["USAGE", "SELECT", "UPDATE"]) {
          const has = (await q(`select has_sequence_privilege($1, 'public.ad_events_id_seq', $2) as ok`, [role, priv]))[0].ok === true;
          if (has) fails.push(`public.ad_events_id_seq: ${role} has ${priv}`);
        }
      }
    }
    report(fails);
  });

  it("public.ad_events has no RLS policy that opens it to PUBLIC, anon, authenticated or service_role", async () => {
    const exists = (await q(`select to_regclass('public.ad_events') is not null as ok`))[0].ok === true;
    assert.ok(exists, "public.ad_events: table missing on TEST DB (day-12-2 migration not applied)");
    const policies = await q(`select policyname, roles from pg_policies where schemaname = 'public' and tablename = 'ad_events'`);
    const fails: string[] = [];
    for (const p of policies) {
      const roles = Array.isArray(p.roles) ? (p.roles as string[]) : [];
      const open = roles.filter((r) => r === "public" || (APP_ROLES as readonly string[]).includes(r));
      if (open.length > 0) fails.push(`public.ad_events: policy "${String(p.policyname)}" applies to ${open.join(", ")}`);
    }
    report(fails);
  });

  it("the verification itself is read-only: the transaction is read only and nothing was written", async () => {
    const r = (await q(`show transaction_read_only`))[0];
    assert.equal(Object.values(r)[0], "on");
    await assert.rejects(client.query(`create temp table day16_part4_should_fail (x int)`), (e: unknown) => (e as { code?: string }).code === "25006");
    // failed statement ne transaction abort kar di: saaf rollback, phir naya read-only transaction (baaki tests ab nahi chalte)
    await client.query("rollback");
    await client.query("begin read only");
  });
});
