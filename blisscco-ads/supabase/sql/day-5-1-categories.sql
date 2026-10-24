-- =====================================================================
-- BLISSCCO | Day 5 | Part 1 : controlled category taxonomy (ad_categories)
-- Pehle Day 3 Part 1-5 aur Day 4 Part 1 + 3 chale hone chahiye.
-- Dobara chalane par safe hai. Koi drop table / delete / truncate nahi.
--
-- Pehle: campaigns.category aur publishers.category sirf slug-format check wale text the.
-- List sirf app code me thi, isliye API se koi bhi slug ghus sakta tha.
-- Ab: ek chhoti table ad_categories + foreign key. Matching sirf is_active = true wali
-- categories par chalti hai.
--
-- 'beauty' LEGACY hai (is_active = false): purane test data (day-3-6 SETUP) me 'beauty'
-- use hua tha. Wo row sirf isliye hai ki purani rows/tests foreign key se na tootein;
-- 'beauty' par ad kabhi match nahi hoga.
--
-- Sensitive categories (health, religion, politics, sexuality, ...) is list me KABHI
-- mat jodna. Taxonomy hi privacy ka pehla filter hai.
-- =====================================================================

begin;

create table if not exists public.ad_categories (
  slug       text primary key,
  label      text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),

  constraint ad_categories_slug_check  check (slug ~ '^[a-z0-9_]{1,50}$'),
  constraint ad_categories_label_check check (char_length(btrim(label)) between 1 and 60)
);

comment on table public.ad_categories is 'Controlled topic taxonomy. Matching sirf is_active = true categories par chalti hai.';

-- Rerun-safe: maujooda rows ko badalta nahi (admin ne deactivate kiya ho toh wapas active nahi hota).
insert into public.ad_categories (slug, label, is_active, sort_order) values
  ('developer_tools', 'Developer tools', true,  10),
  ('education',       'Education',       true,  20),
  ('finance',         'Finance',         true,  30),
  ('fitness',         'Fitness',         true,  40),
  ('food',            'Food',            true,  50),
  ('gaming',          'Gaming',          true,  60),
  ('lifestyle',       'Lifestyle',       true,  70),
  ('technology',      'Technology',      true,  80),
  ('travel',          'Travel',          true,  90),
  ('beauty',          'Beauty (legacy)', false, 900)
on conflict (slug) do nothing;

-- Access band: app sirf server (security definer function) se padhegi.
alter table public.ad_categories enable row level security;
revoke all on table public.ad_categories from public, anon, authenticated;

-- Foreign keys: NOT VALID = naye/badle hue rows par turant lagu, purani rows ki jaanch neeche.
-- (FK ki jaanch table owner ke haq se hoti hai, isliye authenticated ko ad_categories par grant nahi chahiye.)
alter table public.campaigns drop constraint if exists campaigns_category_fk;
alter table public.campaigns add constraint campaigns_category_fk
  foreign key (category) references public.ad_categories (slug)
  on update restrict on delete restrict not valid;

alter table public.publishers drop constraint if exists publishers_category_fk;
alter table public.publishers add constraint publishers_category_fk
  foreign key (category) references public.ad_categories (slug)
  on update restrict on delete restrict not valid;

commit;

-- ---------------------------------------------------------------------
-- CHECK (Expect: 0 rows dono). Agar rows aayein, matlab un campaigns/publishers ki category
-- list me nahi hai; unhe sahi category par badlo (ya yahan us slug ko inactive row ki tarah jodo).
-- ---------------------------------------------------------------------
--   select distinct category from public.campaigns  where category not in (select slug from public.ad_categories);
--   select distinct category from public.publishers where category is not null and category not in (select slug from public.ad_categories);

-- Purani rows ki jaanch (alag statement). Agar upar wale check me rows aayi hon toh ye ERROR dega;
-- ye theek hai, constraint NOT VALID rehta hai aur naye data par phir bhi lagu rehta hai.
alter table public.campaigns  validate constraint campaigns_category_fk;
alter table public.publishers validate constraint publishers_category_fk;
