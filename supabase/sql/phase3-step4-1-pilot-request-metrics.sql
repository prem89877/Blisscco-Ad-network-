-- =====================================================================
-- BLISSCCO | Phase 3 Step 4 | Migration (file phase3-step4-1) : pilot monitoring ke liye request metrics (aggregate counters) + admin summary
-- Pehle day-3-5 (private.is_admin), day-5-3 (ad_serve_log, campaign_spend_daily), day-12-2 (ad_events), day-13-1 (financial_ledger) chali hon.
-- Dobara chalane par safe hai (create if not exists / create or replace).
-- PEHLE TEST project par chalao. Production par is step me NAHI (MVP-PILOT-SAFETY-CHECKLIST.md). (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Ye migration kyun ZAROORI hai:
--   Fill / no-fill / error ginti aur latency pehle kahin store nahi hoti thi (sirf serve, impression, click, spend, ledger). Ye sirf naya aggregate counter table hai.
--
-- Is file me:
--  A. public.ad_request_metrics_hourly : ghante ke bucket me (outcome) ka count + latency total/max. Ek row = ek ghanta x ek outcome.
--     KOI prompt, topic, publisher key, IP, user id, campaign id, ad text yahan nahi hai (columns hi nahi hain).
--  B. public.record_ad_request_metric(p_outcome, p_latency_ms) : sirf service_role. Ek counter badhata hai. Galat outcome / latency => error (kuch likha nahi jaata).
--  C. public.get_pilot_monitoring_summary(p_days) : SIRF admin (private.is_admin()). Admin na ho toh 0 rows. Sirf padhta hai:
--       request counts, latency, serves, impressions, clicks, campaign spend, ledger charges, publisher earnings, manual ledger entries.
--
-- Jo NAHI badalta: record_ad_serve, record_ad_impression, record_ad_click, ad_events, ad_serve_log, campaign_spend_daily, financial_ledger,
--   ledger / payout functions, RLS, koi existing grant. Billing aur ledger ko ye migration chhuta bhi nahi (sirf padhta hai).
--
-- Limits (jaan-boojh kar, jhooth nahi):
--   - Publisher ke apne timeouts yahan nahi dikhte (wo publisher ke server par hote hain). Yahan sirf Blisscco server ki taraf ki latency hai.
--   - Retention: is table ke purge ka koi job NAHI hai (ghante x 7 outcome = bahut chhoti rows). Purge ka faisla alag (owner).
--   - Ek hi ghante-outcome row par bahut saari requests ek saath aayein toh row-lock par line lagti hai. App ye call response ke BAAD karti hai,
--     isliye ad ka jawab nahi rukta; par DB par asar real traffic par naapna baaki hai (abhi koi naap nahi hai).
--   - Window: aaj (UTC) milakar p_days din (1..31). Spend din ke hisaab se (UTC date), ledger / events / serves created/received time se: dono UTC din ki shuruaat se.
-- =====================================================================

begin;

-- ---------- A. table ----------
create table if not exists public.ad_request_metrics_hourly (
  bucket_start     timestamptz not null,
  outcome          text        not null,
  request_count    bigint      not null default 0,
  latency_samples  bigint      not null default 0,
  latency_total_ms bigint      not null default 0,
  latency_max_ms   integer     not null default 0,

  primary key (bucket_start, outcome),
  constraint ad_request_metrics_outcome_check check (
    outcome in ('fill', 'provider_fill', 'no_fill', 'unauthorized', 'rate_limited', 'invalid_request', 'unavailable')
  ),
  constraint ad_request_metrics_counts_check check (
    request_count >= 0 and latency_samples >= 0 and latency_total_ms >= 0 and latency_max_ms >= 0
  )
);

comment on table public.ad_request_metrics_hourly is
  'Match endpoint ke aggregate counters (ghanta x outcome). Koi prompt / topic / key / IP / user id / campaign id nahi. Sirf security-definer code likhta aur padhta hai.';

-- access band (project ka tareeka: RLS on, koi policy nahi, saare roles se grant hata)
alter table public.ad_request_metrics_hourly enable row level security;
revoke all on table public.ad_request_metrics_hourly from public, anon, authenticated, service_role;

-- ---------- B. writer ----------
create or replace function public.record_ad_request_metric(p_outcome text, p_latency_ms integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome is null
     or p_outcome not in ('fill', 'provider_fill', 'no_fill', 'unauthorized', 'rate_limited', 'invalid_request', 'unavailable') then
    raise exception 'invalid metric outcome' using errcode = '22023';
  end if;
  if p_latency_ms is null or p_latency_ms < 0 or p_latency_ms > 3600000 then
    raise exception 'invalid metric latency' using errcode = '22023';
  end if;

  insert into public.ad_request_metrics_hourly as m
    (bucket_start, outcome, request_count, latency_samples, latency_total_ms, latency_max_ms)
  values
    (date_trunc('hour', now()), p_outcome, 1, 1, p_latency_ms, p_latency_ms)
  on conflict (bucket_start, outcome) do update
    set request_count    = m.request_count + 1,
        latency_samples  = m.latency_samples + 1,
        latency_total_ms = m.latency_total_ms + excluded.latency_total_ms,
        latency_max_ms   = greatest(m.latency_max_ms, excluded.latency_max_ms);
end;
$$;

revoke all on function public.record_ad_request_metric(text, integer) from public, anon, authenticated;
grant execute on function public.record_ad_request_metric(text, integer) to service_role;

comment on function public.record_ad_request_metric(text, integer) is
  'Ek match request ka outcome + latency (ms) ek aggregate counter me jodta hai. Sirf service_role. Kuch aur nahi likhta.';

-- ---------- C. admin summary (sirf padhta hai) ----------
create or replace function public.get_pilot_monitoring_summary(p_days integer default 7)
returns table (
  req_fill          bigint,
  req_provider_fill bigint,
  req_no_fill       bigint,
  req_unauthorized  bigint,
  req_rate_limited  bigint,
  req_invalid       bigint,
  req_unavailable   bigint,
  latency_samples   bigint,
  latency_total_ms  bigint,
  latency_max_ms    integer,
  serves            bigint,
  impressions       bigint,
  clicks            bigint,
  campaign_spend    text,
  ledger_charges    text,
  publisher_earnings text,
  manual_entries    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select (date_trunc('day', now() at time zone 'utc') - (least(greatest(coalesce(p_days, 7), 1), 31) - 1) * interval '1 day') at time zone 'utc' as start_ts
  ),
  r as (
    select coalesce(sum(m.request_count) filter (where m.outcome = 'fill'), 0)::bigint            as req_fill,
           coalesce(sum(m.request_count) filter (where m.outcome = 'provider_fill'), 0)::bigint   as req_provider_fill,
           coalesce(sum(m.request_count) filter (where m.outcome = 'no_fill'), 0)::bigint         as req_no_fill,
           coalesce(sum(m.request_count) filter (where m.outcome = 'unauthorized'), 0)::bigint    as req_unauthorized,
           coalesce(sum(m.request_count) filter (where m.outcome = 'rate_limited'), 0)::bigint    as req_rate_limited,
           coalesce(sum(m.request_count) filter (where m.outcome = 'invalid_request'), 0)::bigint as req_invalid,
           coalesce(sum(m.request_count) filter (where m.outcome = 'unavailable'), 0)::bigint     as req_unavailable,
           coalesce(sum(m.latency_samples), 0)::bigint                                           as latency_samples,
           coalesce(sum(m.latency_total_ms), 0)::bigint                                          as latency_total_ms,
           coalesce(max(m.latency_max_ms), 0)::integer                                           as latency_max_ms
    from public.ad_request_metrics_hourly m, w
    where m.bucket_start >= w.start_ts
  ),
  sv as (
    select count(*)::bigint as serves
    from public.ad_serve_log s, w
    where s.served_at >= w.start_ts
  ),
  ev as (
    select count(*) filter (where e.event_type = 'impression')::bigint as impressions,
           count(*) filter (where e.event_type = 'click')::bigint      as clicks
    from public.ad_events e, w
    where e.received_at >= w.start_ts and e.event_type in ('impression', 'click')
  ),
  sp as (
    select coalesce(sum(d.spent), 0)::numeric(20, 4)::text as campaign_spend
    from public.campaign_spend_daily d, w
    where d.day >= (w.start_ts at time zone 'utc')::date
  ),
  lg as (
    select coalesce(sum(l.amount) filter (where l.entry_type = 'advertiser_charge'), 0)::numeric(20, 4)::text  as ledger_charges,
           coalesce(sum(l.amount) filter (where l.entry_type = 'publisher_earning'), 0)::numeric(20, 4)::text  as publisher_earnings,
           count(*) filter (where l.entry_type in ('adjustment', 'reversal'))::bigint                          as manual_entries
    from public.financial_ledger l, w
    where l.created_at >= w.start_ts and l.currency_code = 'USD'
  )
  select r.req_fill, r.req_provider_fill, r.req_no_fill, r.req_unauthorized, r.req_rate_limited, r.req_invalid, r.req_unavailable,
         r.latency_samples, r.latency_total_ms, r.latency_max_ms,
         sv.serves, ev.impressions, ev.clicks,
         sp.campaign_spend, lg.ledger_charges, lg.publisher_earnings, lg.manual_entries
  from r, sv, ev, sp, lg
  where (select private.is_admin())
$$;

revoke all on function public.get_pilot_monitoring_summary(integer) from public, anon, service_role;
grant execute on function public.get_pilot_monitoring_summary(integer) to authenticated;

comment on function public.get_pilot_monitoring_summary(integer) is
  'Admin-only pilot monitoring totals (requests by outcome, latency, serves, impressions, clicks, spend, ledger charges, publisher earnings, manual ledger entries). Admin na ho toh 0 rows. Sirf padhta hai.';

commit;

-- Check 1 (Expect: 2 rows; record_ad_request_metric prosecdef = true; get_pilot_monitoring_summary prosecdef = true, provolatile = 's')
--   select proname, prosecdef, provolatile from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('record_ad_request_metric', 'get_pilot_monitoring_summary') order by 1;
-- Check 2 (Expect: record_ad_request_metric -> sirf service_role; get_pilot_monitoring_summary -> sirf authenticated; anon / PUBLIC ko koi EXECUTE nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('record_ad_request_metric', 'get_pilot_monitoring_summary')
--   and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Check 3 (Expect: table par kisi role ko privilege nahi => 0 rows)
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'ad_request_metrics_hourly' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
-- Check 4 (TEST DATABASE ONLY, service_role session se; phir admin session se summary: counts 1 se badhe; non-admin session se summary: 0 rows)
--   select public.record_ad_request_metric('no_fill', 12);
--   select * from public.get_pilot_monitoring_summary(1);
