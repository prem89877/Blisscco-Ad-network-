-- =====================================================================
-- BLISSCCO | Day 13 | Part 6 | READ-ONLY consistency check (sirf SELECT: kuch nahi badalta, koi balance nahi, koi function / table nahi banta)
-- (Ye file kisi database par chalayi NAHI gayi hai.) Kisi bhi samay chala sakte ho: denim (test) aur asli (blisscco ad network) dono par safe.
-- Expect: har row status = PASS. FAIL row ka matlab hai ki ledger / payout records aapas me milte nahi: kuch THEEK karne se pehle admin ko dikhao (data haath se mat badlo:
-- ledger append-only hai, galti ka ilaaj reversal / adjustment hai).
--
-- Kya jaanchta hai (sirf wahi jo ASAL me implemented niyam hain):
--   1. Ek serve par publisher_earning + platform_revenue = advertiser_charge (jab dono / koi ek maujood ho; 0 wali entry banti hi nahi, isliye ek akeli bhi ho sakti hai).
--   2. Koi publisher_earning / platform_revenue bina advertiser_charge ke nahi.
--   3. Koi serve entry kisi doosre campaign / publisher ki nahi: ek serve ki saari entries ka campaign (aur earning ka publisher) ek hi.
--   4. Har publisher ke liye: ledger balance >= (requested + approved) + paid  (warna FAIL: reversal / negative adjustment ke baad payout record balance se bada hai -> admin ko reject karna hai).
--   5. Har paid request ke paas paid_by / paid_at aur audit event hai; har request ka audit trail uske status tak pahunchta hai.
--   6. Ek publisher ke ek se zyada khule payout request nahi.
-- Jo YAHAN NAHI jaanchta: advertiser_charge ka campaign_spend_daily se milan. Ledger default me band tha aur koi backfill nahi hua, isliye puraane dino ke totals milte hi nahi;
--   neeche ek alag INFO query hai (PASS / FAIL nahi) jo sirf poore band-hue dino ke liye dono ko saath dikhati hai.
-- =====================================================================

with serve_totals as (
  select l.source_ref,
         coalesce(sum(l.amount) filter (where l.entry_type = 'advertiser_charge'), 0)  as charge,
         coalesce(sum(l.amount) filter (where l.entry_type = 'publisher_earning'), 0)  as earning,
         coalesce(sum(l.amount) filter (where l.entry_type = 'platform_revenue'), 0)   as platform,
         count(*) filter (where l.entry_type = 'advertiser_charge')                    as charge_rows,
         count(distinct l.campaign_id)                                                 as campaigns,
         count(distinct l.publisher_id) filter (where l.entry_type = 'publisher_earning') as earning_publishers
  from public.financial_ledger l
  where l.source_type = 'serve'
  group by l.source_ref
),
positions as (
  select p.id as publisher_id,
         coalesce((select sum(l.amount) from public.financial_ledger l where l.publisher_id = p.id and l.account = 'publisher' and l.currency_code = 'USD'), 0) as ledger_balance,
         coalesce((select sum(r.amount) from public.publisher_payout_requests r where r.publisher_id = p.id and r.status in ('requested', 'approved')), 0) as reserved,
         coalesce((select sum(r.amount) from public.publisher_payout_requests r where r.publisher_id = p.id and r.status = 'paid'), 0) as paid
  from public.publishers p
),
checks(name, ok, got) as (
  values

  ('1. per serve: publisher_earning + platform_revenue = advertiser_charge (when a split exists)',
     not exists (select 1 from serve_totals s where (s.earning > 0 or s.platform > 0) and s.earning + s.platform <> s.charge),
     (select string_agg(s.source_ref, ', ') from (select source_ref from serve_totals t where (t.earning > 0 or t.platform > 0) and t.earning + t.platform <> t.charge limit 5) s)),

  ('2. no publisher_earning / platform_revenue without an advertiser_charge for the same serve',
     not exists (select 1 from serve_totals s where s.charge_rows = 0),
     (select string_agg(s.source_ref, ', ') from (select source_ref from serve_totals t where t.charge_rows = 0 limit 5) s)),

  ('3. one serve = one campaign (and one publisher for the earning)',
     not exists (select 1 from serve_totals s where s.campaigns > 1 or s.earning_publishers > 1),
     (select string_agg(s.source_ref, ', ') from (select source_ref from serve_totals t where t.campaigns > 1 or t.earning_publishers > 1 limit 5) s)),

  ('4. every publisher: ledger balance covers requested + approved + paid payouts',
     not exists (select 1 from positions x where x.ledger_balance < x.reserved + x.paid),
     (select string_agg(s.publisher_id::text, ', ') from (select publisher_id from positions x where x.ledger_balance < x.reserved + x.paid limit 5) s)),

  ('5a. every paid request has paid_by + paid_at and a paid audit event',
     not exists (select 1 from public.publisher_payout_requests r
                 where r.status = 'paid'
                   and (r.paid_by is null or r.paid_at is null
                        or not exists (select 1 from public.publisher_payout_events e where e.payout_request_id = r.id and e.to_status = 'paid'))),
     ''),

  ('5b. every request has a first (requested) audit event and its latest event equals its status',
     not exists (select 1 from public.publisher_payout_requests r
                 where not exists (select 1 from public.publisher_payout_events e where e.payout_request_id = r.id and e.from_status is null and e.to_status = 'requested')
                    or (select e.to_status from public.publisher_payout_events e where e.payout_request_id = r.id order by e.id desc limit 1) is distinct from r.status),
     ''),

  ('6. no publisher has more than one open (requested / approved) payout request',
     not exists (select 1 from public.publisher_payout_requests r where r.status in ('requested', 'approved') group by r.publisher_id having count(*) > 1),
     '')
)
select name, case when ok then 'PASS' else 'FAIL' end as status, got from checks order by name;

-- INFO (PASS / FAIL nahi): har campaign ke liye, un POORE dino ke liye jab ledger poora din chalu tha (pehli ledger entry ke din ke BAAD, aaj se pehle):
-- ledger ka advertiser_charge total vs campaign_spend_daily ka spent. Dono ek hi serve se bante hain, isliye milne chahiye. Ledger band hone / ON hone ke beech ke dino par milan na ho sakta hai.
--   with first_day as (select (min(created_at) at time zone 'UTC')::date as d from public.financial_ledger where entry_type = 'advertiser_charge'),
--   l as (select campaign_id, (created_at at time zone 'UTC')::date as day, sum(amount) as charged from public.financial_ledger where entry_type = 'advertiser_charge' group by 1, 2)
--   select s.campaign_id, s.day, s.spent, coalesce(l.charged, 0) as ledger_charged
--   from public.campaign_spend_daily s cross join first_day f left join l on l.campaign_id = s.campaign_id and l.day = s.day
--   where s.day > f.d and s.day < (now() at time zone 'UTC')::date and s.spent is distinct from coalesce(l.charged, 0)
--   order by s.day desc limit 50;
