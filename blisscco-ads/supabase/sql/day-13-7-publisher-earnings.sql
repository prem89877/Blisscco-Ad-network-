-- =====================================================================
-- BLISSCCO | Day 13 | Part 3 | Migration (file day-13-7) : publisher earnings ke liye READ-ONLY functions
-- Pehle chali honi chahiye: day-13-1 (financial_ledger), day-13-4 (ledger_settings). Dobara chalane par safe hai (create or replace).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Ye migration kyun ZAROORI hai (naya table / column / trigger nahi):
--   financial_ledger par kisi bhi role ko table-grant nahi (service_role ko bhi nahi, day-13-1). Isliye app ke paas ledger padhne ka koi raasta nahi.
--   Project ka tareeka (day-12-12 jaisa): security-definer function jo CALLER ki pehchaan (auth.uid()) se ownership khud jaanche.
--   Publisher ki id kabhi parameter me nahi aati: function logged-in user ka apna publisher khud nikalta hai. Isliye "doosre ki id bhejo" wala raasta hi nahi hai.
--   Service-role key ka is feature me koi kaam nahi.
--
-- Is file me sirf 2 functions:
--  A. public.get_my_publisher_earnings()
--       Ek row (ya 0 rows agar caller ka active publisher nahi): ledger_enabled, share_configured, currency_code,
--       total_earned (publisher_earning ka jod), total_adjustments (publisher account ke adjustment ka jod, signed),
--       total_reversals (publisher account ke reversal ka jod, signed), ledger_balance (publisher account ki SAARI entries ka jod),
--       entry_count, last_entry_at. Paisa TEXT me (numeric ka exact text, jaise "0.0250"), kabhi float nahi.
--  B. public.get_my_publisher_ledger_entries(p_limit integer default 25)
--       Caller ke publisher ki apni entries, naye pehle, limit 1..100. Sirf: entry_id, entry_type, amount (text), currency_code, created_at.
--       KABHI nahi milta: advertiser_id, campaign_id, source_ref (serve ka reference), created_by, reason, publisher_id, doosri party ki koi entry.
--
-- Kaun dekh sakta hai: sirf logged-in (authenticated) user jiska profile ACTIVE ho aur jiska publisher row ho (get_my_publisher_analytics jaisa niyam).
-- Advertiser / admin / anon / suspended profile / publisher-row-nahi: 0 rows. anon aur service_role ko EXECUTE nahi.
--
-- Jo kuch ledger me hai hi nahi, wo yahan bhi nahi: pending / approved / paid-out ka koi status ya payout entry-type schema me NAHI hai
-- (entry_type sirf advertiser_charge | publisher_earning | platform_revenue | adjustment | reversal). Isliye in teeno ke liye koi column nahi banaya (inventing mana hai).
-- Currency: ledger sirf USD (CHECK). Function sirf USD rows jodta hai.
--
-- Jo NAHI badalta: financial_ledger, ledger_settings, record_ad_serve, billing / charge / revenue-share ka hisab, spend, budget, RLS, koi existing grant.
-- =====================================================================

begin;

-- ---------- A. summary ----------
create or replace function public.get_my_publisher_earnings()
returns table (
  ledger_enabled     boolean,
  share_configured   boolean,
  currency_code      text,
  total_earned       text,
  total_adjustments  text,
  total_reversals    text,
  ledger_balance     text,
  entry_count        bigint,
  last_entry_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.ledger_enabled, false),
         (s.publisher_share_bps is not null),
         'USD'::text,
         coalesce(sum(l.amount) filter (where l.entry_type = 'publisher_earning'), 0)::numeric(20, 4)::text,
         coalesce(sum(l.amount) filter (where l.entry_type = 'adjustment'), 0)::numeric(20, 4)::text,
         coalesce(sum(l.amount) filter (where l.entry_type = 'reversal'), 0)::numeric(20, 4)::text,
         coalesce(sum(l.amount), 0)::numeric(20, 4)::text,
         count(l.id),
         max(l.created_at)
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  left join public.ledger_settings s on s.id
  left join public.financial_ledger l
         on l.publisher_id = p.id and l.account = 'publisher' and l.currency_code = 'USD'
  where p.profile_id = (select auth.uid()) and pr.status = 'active'
  group by p.id, s.ledger_enabled, s.publisher_share_bps
$$;

revoke all on function public.get_my_publisher_earnings() from public, anon, service_role;
grant execute on function public.get_my_publisher_earnings() to authenticated;

comment on function public.get_my_publisher_earnings() is
  'Caller ke apne publisher ki ledger totals (earned / adjustments / reversals / balance, USD, exact text). Publisher id parameter nahi: auth.uid() se. Pending / approved / paid schema me nahi, isliye nahi. Sirf padhta hai.';

-- ---------- B. apni entries ----------
create or replace function public.get_my_publisher_ledger_entries(p_limit integer default 25)
returns table (
  entry_id       uuid,
  entry_type     text,
  amount         text,
  currency_code  text,
  created_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.entry_id,
         l.entry_type,
         l.amount::numeric(14, 4)::text,
         l.currency_code,
         l.created_at
  from public.publishers p
  join public.profiles pr on pr.id = p.profile_id
  join public.financial_ledger l
    on l.publisher_id = p.id and l.account = 'publisher' and l.currency_code = 'USD'
  where p.profile_id = (select auth.uid()) and pr.status = 'active'
  order by l.created_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
$$;

revoke all on function public.get_my_publisher_ledger_entries(integer) from public, anon, service_role;
grant execute on function public.get_my_publisher_ledger_entries(integer) to authenticated;

comment on function public.get_my_publisher_ledger_entries(integer) is
  'Caller ke apne publisher ki ledger entries (naye pehle, max 100). Campaign / advertiser / serve reference / reason / created_by kabhi nahi. Sirf padhta hai.';

commit;

-- Check 1 (Expect: 2 rows, dono prosecdef = true, provolatile = 's')
--   select proname, prosecdef, provolatile from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries') order by 1;
-- Check 2 (Expect: sirf 'authenticated' ke paas EXECUTE; anon / PUBLIC / service_role nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('get_my_publisher_earnings', 'get_my_publisher_ledger_entries')
--   and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Phir day-13-8-publisher-earnings-tests.sql (rollback-only, sirf TEST) chalao.
