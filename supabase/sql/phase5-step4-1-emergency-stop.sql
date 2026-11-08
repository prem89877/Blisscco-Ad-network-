-- =====================================================================
-- BLISSCCO | Phase 5 Step 4 | Migration (file phase5-step4-1) : emergency stop of ALL ad serving (admin button) + append-only audit log
-- Pehle day-3-5 (private.is_admin) chali honi chahiye. Dobara chalane par safe hai (create if not exists / create or replace).
-- PEHLE TEST project par chalao. Production par sirf owner ke likhit faisle ke baad. (Ye file kisi database par chalayi NAHI gayi hai.)
--
-- Is file me:
--  A. public.platform_safety_state : EK row (id = true). ad_serving_stopped (default false), reason, changed_at, changed_by.
--  B. public.safety_audit_log      : append-only itihaas (stop / resume, kisne, kab, kyun). UPDATE / DELETE / TRUNCATE band.
--  C. public.admin_set_ad_serving_stopped(p_stopped, p_reason) : SIRF admin. Flag badalta hai + audit row likhta hai. Reason zaroori (3..200 chars).
--  D. public.get_ad_serving_state()      : SIRF service_role. Server ka match endpoint har request par flag padhta hai (sirf jab EMERGENCY_STOP_ENFORCED=1).
--  E. public.get_admin_safety_state()    : SIRF admin. Admin page par state + pichhli 5 audit rows dikhane ke liye.
--
-- Jo NAHI badalta: record_ad_serve, authorize_publisher_key, campaigns, publishers, advertisers, ledger, payouts, spend, billing, koi existing grant.
--   Ye flag sirf naya serve rokta hai. Resume khud se kabhi nahi hota (sirf admin ka "Resume" button).
-- Aisa kuch nahi jo refund ya payout kare.
-- =====================================================================

begin;

-- ---------- A. state (ek row) ----------
create table if not exists public.platform_safety_state (
  id                 boolean     primary key default true,
  ad_serving_stopped boolean     not null default false,
  reason             text,
  changed_at         timestamptz not null default now(),
  changed_by         uuid,
  constraint platform_safety_state_single_row check (id)
);

insert into public.platform_safety_state (id) values (true) on conflict (id) do nothing;

comment on table public.platform_safety_state is
  'Ek row. ad_serving_stopped = true => match endpoint koi naya ad serve nahi karta. Sirf security-definer functions padhte / likhte hain.';

alter table public.platform_safety_state enable row level security;
revoke all on table public.platform_safety_state from public, anon, authenticated, service_role;

-- ---------- B. audit log (append-only) ----------
create table if not exists public.safety_audit_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  action     text        not null,
  reason     text        not null,
  actor_id   uuid,
  constraint safety_audit_log_action_check check (action in ('ad_serving_stopped', 'ad_serving_resumed')),
  constraint safety_audit_log_reason_check check (char_length(reason) between 3 and 200)
);

comment on table public.safety_audit_log is
  'Safety actions ka append-only itihaas (kisne, kab, kyun). Koi secret, key ya personal data nahi.';

alter table public.safety_audit_log enable row level security;
revoke all on table public.safety_audit_log from public, anon, authenticated, service_role;

create or replace function private.safety_audit_log_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'safety_audit_log is append-only' using errcode = '42501';
end;
$$;

revoke all on function private.safety_audit_log_immutable() from public, anon, authenticated;

drop trigger if exists safety_audit_log_no_update on public.safety_audit_log;
create trigger safety_audit_log_no_update
  before update or delete on public.safety_audit_log
  for each row execute function private.safety_audit_log_immutable();

drop trigger if exists safety_audit_log_no_truncate on public.safety_audit_log;
create trigger safety_audit_log_no_truncate
  before truncate on public.safety_audit_log
  for each statement execute function private.safety_audit_log_immutable();

-- ---------- C. admin switch ----------
create or replace function public.admin_set_ad_serving_stopped(p_stopped boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
begin
  if not (select private.is_admin()) then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_stopped is null then
    raise exception 'Invalid state' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'Reason must be 3 to 200 characters' using errcode = '22023';
  end if;

  update public.platform_safety_state
     set ad_serving_stopped = p_stopped,
         reason             = v_reason,
         changed_at         = now(),
         changed_by         = auth.uid()
   where id = true;

  insert into public.safety_audit_log (action, reason, actor_id)
  values (case when p_stopped then 'ad_serving_stopped' else 'ad_serving_resumed' end, v_reason, auth.uid());
end;
$$;

revoke all on function public.admin_set_ad_serving_stopped(boolean, text) from public, anon, service_role;
grant execute on function public.admin_set_ad_serving_stopped(boolean, text) to authenticated;

comment on function public.admin_set_ad_serving_stopped(boolean, text) is
  'Admin-only: sab ad serving rokta / dobara chalu karta hai. Reason zaroori, audit row likhta hai. Resume sirf admin ke haath se.';

-- ---------- D. server read (match endpoint) ----------
create or replace function public.get_ad_serving_state()
returns table (ad_serving_stopped boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.ad_serving_stopped from public.platform_safety_state s where s.id = true
$$;

revoke all on function public.get_ad_serving_state() from public, anon, authenticated;
grant execute on function public.get_ad_serving_state() to service_role;

comment on function public.get_ad_serving_state() is
  'Sirf service_role: kya sab ad serving roki gayi hai? Sirf padhta hai.';

-- ---------- E. admin read ----------
create or replace function public.get_admin_safety_state()
returns table (
  ad_serving_stopped boolean,
  reason             text,
  changed_at         timestamptz,
  recent_actions     jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.ad_serving_stopped,
         s.reason,
         s.changed_at,
         coalesce(
           (select jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'at', a.created_at) order by a.created_at desc, a.id desc)
              from (select * from public.safety_audit_log order by created_at desc, id desc limit 5) a),
           '[]'::jsonb
         )
  from public.platform_safety_state s
  where s.id = true and (select private.is_admin())
$$;

revoke all on function public.get_admin_safety_state() from public, anon, service_role;
grant execute on function public.get_admin_safety_state() to authenticated;

comment on function public.get_admin_safety_state() is
  'Admin-only: stop switch ki state + pichhli 5 audit rows. Admin na ho toh 0 rows. Sirf padhta hai.';

commit;

-- Check 1 (Expect: 1 row, ad_serving_stopped = false) -- service_role / SQL editor se
--   select * from public.get_ad_serving_state();
-- Check 2 (Expect: 3 functions prosecdef = true)
--   select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('admin_set_ad_serving_stopped', 'get_ad_serving_state', 'get_admin_safety_state') order by 1;
-- Check 3 (Expect: admin_set_* aur get_admin_* -> sirf authenticated; get_ad_serving_state -> sirf service_role; anon / PUBLIC ko koi EXECUTE nahi)
--   select routine_name, grantee from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name in ('admin_set_ad_serving_stopped', 'get_ad_serving_state', 'get_admin_safety_state')
--   and grantee in ('PUBLIC', 'public', 'anon', 'authenticated', 'service_role') order by 1, 2;
-- Check 4 (Expect: dono tables par kisi role ko privilege nahi => 0 rows)
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('platform_safety_state', 'safety_audit_log') and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
-- Check 5 (TEST DATABASE ONLY, admin session se Preview page ka button dabao: Stop phir Resume): audit log me 2 rows, state wapas false.
--   Non-admin session se admin_set_ad_serving_stopped => error 42501.
