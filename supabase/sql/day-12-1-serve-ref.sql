-- =====================================================================
-- BLISSCCO | Day 12 | Part 2 | Migration 1 of 2 (file day-12-1) : serve ka stable, unique, bahar-safe reference (serve_ref)
-- Pehle day-5-3, day-9-5 chali honi chahiye. Dobara chalane par safe hai (idempotent).
-- PEHLE TEST project (denim) par chalao, phir asli (blisscco ad network) par. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Kya karta hai (sirf ad_serve_log par, additive):
--  A. ad_serve_log.serve_ref : naya nullable column. Naye rows ko DEFAULT se apne aap milta hai
--     ("bsr_" + 40 hex random chars, >= 150 bit). record_ad_serve ko BADALNE ki zaroorat nahi: uska INSERT column list me
--     serve_ref nahi likhta, isliye default chalta hai. Billing / spend / API response bilkul wahi.
--  B. serve_ref par unique index (lookup + duplicate reference rokne ke liye).
--  C. Format CHECK (sirf "bsr_" + 40 hex) aur "naye rows me null nahi" CHECK (NOT VALID: purani rows ko nahi chhuta).
--  D. UNIQUE (id, publisher_id, creative_id, campaign_id): events table ka composite FK isi par tikega, taaki
--     DATABASE khud pakka kare ki event ka publisher/campaign/creative usi serve ka hai (caller galat attribution bhej hi nahi sakta).
--
-- Jo NAHI hota: koi table/column drop nahi, table rewrite nahi (column default baad me set hota hai, isliye purani rows
-- NULL rehti hain), koi purani row nahi badalti, spend/billing ko haath nahi, RLS/grants nahi badalte, serve_ref API me nahi jaata.
-- Purani (migration se pehle ki) serves ka serve_ref NULL rehta hai: unpar event aa hi nahi sakta (reference hai hi nahi). Ye jaan-boojh kar hai.
-- Lock: ALTER TABLE chhote waqt ke liye ad_serve_log par lock leta hai; unique index banana table size ke hisaab se. Kam traffic me chalao.
-- =====================================================================

begin;

-- ---------- A. column + default (do alag step: purani rows ko rewrite/backfill nahi) ----------
alter table public.ad_serve_log add column if not exists serve_ref text;

alter table public.ad_serve_log
  alter column serve_ref set default ('bsr_' || substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 40));

comment on column public.ad_serve_log.serve_ref is
  'Opaque public reference of ONE serve (bsr_ + 40 hex). Events isi se serve dhoondte hain. Sequential id (id) kabhi bahar nahi jaata. NULL = migration se pehle ki serve (event nahi le sakti).';

-- ---------- B. unique index ----------
create unique index if not exists ad_serve_log_serve_ref_key on public.ad_serve_log (serve_ref);

-- ---------- C. CHECKs ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_serve_ref_format') then
    alter table public.ad_serve_log
      add constraint ad_serve_log_serve_ref_format check (serve_ref is null or serve_ref ~ '^bsr_[0-9a-f]{40}$');
  end if;

  -- NOT VALID: sirf naye insert/update par lagu. Purani NULL rows ko check nahi karta (aur fail nahi karta).
  -- VALIDATE tab karo jab purani rows purge ho chuki hon (90+ din baad): alter table ... validate constraint ad_serve_log_serve_ref_required;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_serve_ref_required') then
    alter table public.ad_serve_log
      add constraint ad_serve_log_serve_ref_required check (serve_ref is not null) not valid;
  end if;
end
$$;

-- ---------- D. attribution key (events ke composite FK ke liye) ----------
-- id already unique hai, isliye ye constraint kisi nayi pabandi ka matlab nahi rakhta: sirf FK ka target banata hai.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ad_serve_log'::regclass and conname = 'ad_serve_log_attribution_key') then
    alter table public.ad_serve_log
      add constraint ad_serve_log_attribution_key unique (id, publisher_id, creative_id, campaign_id);
  end if;
end
$$;

commit;

-- Check 1 (Expect: 1 row, data_type text, is_nullable YES, column_default me "bsr_")
--   select column_name, data_type, is_nullable, column_default from information_schema.columns
--   where table_schema = 'public' and table_name = 'ad_serve_log' and column_name = 'serve_ref';
-- Check 2 (Expect: 3 rows: ad_serve_log_attribution_key (u), ad_serve_log_serve_ref_format (c), ad_serve_log_serve_ref_required (c, convalidated = false)
--   select conname, contype, convalidated from pg_constraint
--   where conrelid = 'public.ad_serve_log'::regclass and conname like 'ad_serve_log_%' and contype in ('u','c') order by 1;
-- Check 3 (Expect: 1 row) unique index
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'ad_serve_log_serve_ref_key';
-- Check 4 (Expect: purani rows ka null count = migration se pehle ka total; kuch badla nahi)
--   select count(*) filter (where serve_ref is null) as legacy_null, count(*) filter (where serve_ref is not null) as with_ref from public.ad_serve_log;
