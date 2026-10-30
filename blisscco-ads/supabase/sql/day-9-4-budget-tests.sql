-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- TEST DATABASE ONLY (denim).  NEVER RUN THIS FILE ON PRODUCTION (blisscco ad network).
-- TYPE: ROLLBACK-ONLY test (kuch save nahi hota), par TEST fixtures chahiye aur transaction ke andar rows / settings badalta hai.
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- =====================================================================
-- BLISSCCO | Day 9 | Part 2 : budget tests (ROLLBACK-ONLY, kuch save nahi hota)
-- Pehle day-9-3-budget-rules.sql chal chuki honi chahiye.
-- Poora kaam ek DO block me; ant me JAAN-BOOJH KAR error "DAY9_BUDGET_RESULTS [...]" aata hai => poora rollback.
-- Supabase SQL Editor me ek baar me chalao. Us error me JSON hai: har test ka t / expect / got / pass.
-- Pehle apne 2 advertiser ids niche daalo:  select id from public.advertisers;
-- =====================================================================

do $$
declare
  res jsonb := '[]'::jsonb;
  adv_a uuid := '0c327f51-a868-4e47-af01-104aa54d219a';  -- <- advertiser A
  adv_b uuid := '6effeb42-d5a0-4653-9e61-056924dc082e';  -- <- advertiser B (A se alag)
  prof_a uuid; prof_b uuid;
  camp uuid; n bigint; msg text; hnt text;
begin
  select profile_id into prof_a from public.advertisers where id = adv_a;
  select profile_id into prof_b from public.advertisers where id = adv_b;

  perform set_config('request.jwt.claims', json_build_object('sub', prof_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- ===== valid =====
  begin
    insert into public.campaigns (advertiser_id, name, category, total_budget, daily_budget, start_date)
    values (adv_a, 'ZZBUDGET A', 'lifestyle', 100.50, 10.25, current_date) returning id into camp;
    res := res || jsonb_build_object('t','V1 valid total 100.50 / daily 10.25','expect','success','got','success','pass',true);
  exception when others then
    res := res || jsonb_build_object('t','V1 valid total 100.50 / daily 10.25','expect','success','got',sqlstate||' '||sqlerrm,'pass',false);
  end;

  begin update public.campaigns set total_budget = 10000000.00, daily_budget = 10000000.00 where id = camp;
    res := res || jsonb_build_object('t','B1 boundary: total = daily = 10,000,000.00','expect','success','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','B1 boundary: total = daily = 10,000,000.00','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  begin update public.campaigns set total_budget = 10000000.01 where id = camp;
    res := res || jsonb_build_object('t','B2 boundary: total 10,000,000.01','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','B2 boundary: total 10,000,000.01','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  begin update public.campaigns set total_budget = 50, daily_budget = 50 where id = camp;
    res := res || jsonb_build_object('t','B3 boundary: daily = total','expect','success','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','B3 boundary: daily = total','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  -- ===== invalid =====
  begin update public.campaigns set total_budget = 0 where id = camp;
    res := res || jsonb_build_object('t','I1 total 0','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I1 total 0','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  begin update public.campaigns set total_budget = -5 where id = camp;
    res := res || jsonb_build_object('t','I2 total negative','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I2 total negative','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  begin update public.campaigns set daily_budget = 60 where id = camp;
    res := res || jsonb_build_object('t','I3 daily 60 > total 50','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I3 daily 60 > total 50','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  begin update public.campaigns set daily_budget = 0 where id = camp;
    res := res || jsonb_build_object('t','I4 daily 0','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I4 daily 0','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  begin update public.campaigns set total_budget = null where id = camp;
    res := res || jsonb_build_object('t','I5 total null','expect','error 23502','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I5 total null','expect','error 23502','got',sqlstate,'pass',sqlstate='23502'); end;

  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZBUDGET x','lifestyle',20000000,current_date);
    res := res || jsonb_build_object('t','I6 insert total 20,000,000','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','I6 insert total 20,000,000','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  -- ===== kharch (5.00) postgres role se =====
  execute 'reset role';
  insert into public.campaign_spend_daily (campaign_id, day, spent) values (camp, current_date, 5.00);
  perform set_config('request.jwt.claims', json_build_object('sub', prof_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin update public.campaigns set total_budget = 4.99, daily_budget = null where id = camp;
    res := res || jsonb_build_object('t','S1 total 4.99 below spend 5.00','expect','error 23514 + hint budget_below_spend','got','success','pass',false);
  exception when others then
    get stacked diagnostics hnt = pg_exception_hint;
    res := res || jsonb_build_object('t','S1 total 4.99 below spend 5.00','expect','error 23514 + hint budget_below_spend','got',sqlstate||' '||coalesce(hnt,''),'pass',(sqlstate='23514' and hnt='budget_below_spend'));
  end;

  begin update public.campaigns set total_budget = 5.00, daily_budget = null where id = camp;
    res := res || jsonb_build_object('t','S2 boundary: total = spend 5.00','expect','success','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','S2 boundary: total = spend 5.00','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  begin update public.campaigns set total_budget = 5.01 where id = camp;
    res := res || jsonb_build_object('t','S3 total 5.01 above spend','expect','success','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','S3 total 5.01 above spend','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  begin update public.campaigns set name = 'ZZBUDGET renamed' where id = camp;
    res := res || jsonb_build_object('t','S4 rename does not touch budget rule','expect','success','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','S4 rename does not touch budget rule','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  -- ===== postgres role (SQL editor) par bhi rule lagu =====
  execute 'reset role';
  begin update public.campaigns set total_budget = 1 where id = camp;
    res := res || jsonb_build_object('t','S5 SQL-editor role also blocked below spend','expect','error 23514','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','S5 SQL-editor role also blocked below spend','expect','error 23514','got',sqlstate,'pass',sqlstate='23514'); end;

  -- ===== unauthorized: advertiser B =====
  perform set_config('request.jwt.claims', json_build_object('sub', prof_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.campaigns set total_budget = 99999 where id = camp;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('t','U1 B raises A total budget','expect','0 rows','got',n::text,'pass',n=0);
  update public.campaigns set daily_budget = 1 where id = camp;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('t','U2 B changes A daily budget','expect','0 rows','got',n::text,'pass',n=0);
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZBUDGET hijack','lifestyle',10,current_date);
    res := res || jsonb_build_object('t','U3 B inserts campaign for A','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','U3 B inserts campaign for A','expect','error','got',sqlstate,'pass',true); end;

  -- ===== unauthorized: anon =====
  execute 'reset role';
  execute 'set local role anon';
  begin update public.campaigns set total_budget = 99999 where id = camp;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t','U4 anon updates budget','expect','error or 0 rows','got',n::text,'pass',n=0);
  exception when others then res := res || jsonb_build_object('t','U4 anon updates budget','expect','error or 0 rows','got',sqlstate,'pass',true); end;

  -- ===== A ka budget B ke try ke baad waisa hi hai? =====
  execute 'reset role';
  select total_budget::text into msg from public.campaigns where id = camp;
  res := res || jsonb_build_object('t','U5 A budget unchanged after attacks','expect','5.01','got',msg,'pass',msg='5.01');

  raise exception 'DAY9_BUDGET_RESULTS %', res::text;
end $$;

-- Chalane ke baad: kuch save nahi hua? Expect: 0
-- select count(*) from public.campaigns where name like 'ZZBUDGET%';
