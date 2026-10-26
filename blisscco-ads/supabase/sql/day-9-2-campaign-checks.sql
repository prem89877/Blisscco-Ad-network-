-- =====================================================================
-- BLISSCCO | Day 9 | Part 1 : campaign ownership + constraint checks (ROLLBACK-ONLY)
--
-- Ye NAYI migration nahi hai: koi table/policy/function nahi badalta, kuch save nahi karta.
-- Poora kaam ek DO block me hota hai jo ant me JAAN-BOOJH KAR error raise karta hai ("DAY9_RESULTS ..."),
-- isliye poora transaction rollback hota hai. Result us error message me JSON ke roop me aata hai.
-- Supabase SQL Editor me ek baar me poora block chalao. "ERROR P0001 DAY9_RESULTS [...]" dikhna SAHI hai.
--
-- !! Pehle apne project ke 2 advertiser ids niche adv_a / adv_b me daalo:
--      select id, status from public.advertisers;
--
-- CHALAYA GAYA: 26 Oct 2026, project "Blisscco-Ad-network-" (3 active advertisers, 2 draft campaigns).
-- Chalane ke baad check kiya: campaigns 2, test rows 0, spend rows 0 (kuch save nahi hua).
-- Result: pehle run me 27 checks, 26 expected nikle; T4a mera galat test tha (daily 0.001 DB me 0.00 ban jata hai).
--   Dusre run me T4a (0.01/0.01) aur daily 0.001 sahi nikle. Ye file dono runs ko jodkar bani hai (28 checks);
--   jodi hui file ko maine EK saath dobara nahi chalaya, isliye pehli baar chalane par result dekh lena.
-- =====================================================================

do $$
declare
  res jsonb := '[]'::jsonb;
  adv_a uuid := '0c327f51-a868-4e47-af01-104aa54d219a';  -- <- apna advertiser A id
  adv_b uuid := '6effeb42-d5a0-4653-9e61-056924dc082e';  -- <- apna advertiser B id (A se alag)
  prof_a uuid; prof_b uuid;
  camp_a uuid; n bigint; j jsonb;
begin
  select profile_id into prof_a from public.advertisers where id = adv_a;
  select profile_id into prof_b from public.advertisers where id = adv_b;

  -- ===== A (authenticated) =====
  perform set_config('request.jwt.claims', json_build_object('sub', prof_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.campaigns (advertiser_id, name, category, total_budget, daily_budget, start_date)
    values (adv_a, 'ZZTEST A', 'lifestyle', 100, 10, current_date) returning id into camp_a;
    res := res || jsonb_build_object('t','T1 owner inserts valid campaign','expect','success','got','success','pass',true);
  exception when others then
    res := res || jsonb_build_object('t','T1 owner inserts valid campaign','expect','success','got',sqlstate||' '||sqlerrm,'pass',false);
  end;

  begin
    insert into public.campaigns (advertiser_id, name, category, total_budget, start_date)
    values (adv_b, 'ZZTEST hijack', 'lifestyle', 100, current_date);
    res := res || jsonb_build_object('t','T2 insert for another advertiser','expect','error','got','success','pass',false);
  exception when others then
    res := res || jsonb_build_object('t','T2 insert for another advertiser','expect','error','got',sqlstate,'pass',true);
  end;

  -- T3: DB constraints, har ek ko error dena chahiye
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZTEST x','lifestyle',0,current_date);
    res := res || jsonb_build_object('t','T3a total budget 0','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3a total budget 0','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,daily_budget,start_date) values (adv_a,'ZZTEST x','lifestyle',10,20,current_date);
    res := res || jsonb_build_object('t','T3b daily > total','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3b daily > total','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,end_date) values (adv_a,'ZZTEST x','lifestyle',10,current_date,current_date-1);
    res := res || jsonb_build_object('t','T3c end before start','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3c end before start','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'   ','lifestyle',10,current_date);
    res := res || jsonb_build_object('t','T3d blank name','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3d blank name','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,repeat('x',151),'lifestyle',10,current_date);
    res := res || jsonb_build_object('t','T3e name 151 chars','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3e name 151 chars','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZTEST x','nonexistent_cat',10,current_date);
    res := res || jsonb_build_object('t','T3f unknown category','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3f unknown category','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZTEST x','Gaming',10,current_date);
    res := res || jsonb_build_object('t','T3g uppercase category','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3g uppercase category','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,currency_code) values (adv_a,'ZZTEST x','lifestyle',10,current_date,'INR');
    res := res || jsonb_build_object('t','T3h currency not USD','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3h currency not USD','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,status) values (adv_a,'ZZTEST x','lifestyle',10,current_date,'active');
    res := res || jsonb_build_object('t','T3i insert directly as active','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3i insert directly as active','expect','error','got',sqlstate,'pass',true); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,daily_budget,start_date) values (adv_a,'ZZTEST x','lifestyle',1,0.001,current_date);
    res := res || jsonb_build_object('t','T3j daily 0.001 (rounds to 0.00)','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T3j daily 0.001 (rounds to 0.00)','expect','error','got',sqlstate,'pass',true); end;

  -- T4: jo niyam DB me NAHI hain (app code lagata hai): DB inhe ACCEPT karega
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,daily_budget,start_date) values (adv_a,'ZZTEST tiny','lifestyle',0.01,0.01,current_date);
    res := res || jsonb_build_object('t','T4a total 0.01 / daily 0.01 (min budget is app-only)','expect','success (DB has no minimum)','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','T4a total 0.01 / daily 0.01 (min budget is app-only)','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date) values (adv_a,'ZZ'||chr(7)||'bell','lifestyle',10,current_date);
    res := res || jsonb_build_object('t','T4b control char in name (app-only rule)','expect','success (DB accepts)','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','T4b control char in name (app-only rule)','expect','success','got',sqlstate,'pass',false); end;
  begin insert into public.campaigns (advertiser_id,name,category,total_budget,start_date,end_date) values (adv_a,'ZZTEST far','lifestyle',10,date '9999-01-01',date '9999-12-31');
    res := res || jsonb_build_object('t','T4c year-9999 schedule (limit is app-only)','expect','success (DB accepts)','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','T4c year-9999 schedule (limit is app-only)','expect','success','got',sqlstate,'pass',false); end;

  -- T6: owner apna campaign dekh/badal sakta hai
  select count(*) into n from public.campaigns where id = camp_a;
  res := res || jsonb_build_object('t','T6a owner sees own campaign','expect','1','got',n::text,'pass',n=1);
  update public.campaigns set name = 'ZZTEST A renamed' where id = camp_a;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('t','T6b owner renames own campaign','expect','1 row','got',n::text,'pass',n=1);

  -- T8: guard
  begin update public.campaigns set status = 'active' where id = camp_a;
    res := res || jsonb_build_object('t','T8a owner draft -> active directly','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T8a owner draft -> active directly','expect','error','got',sqlstate,'pass',true); end;
  begin update public.campaigns set advertiser_id = adv_b where id = camp_a;
    res := res || jsonb_build_object('t','T8b move campaign to another advertiser','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T8b move campaign to another advertiser','expect','error','got',sqlstate,'pass',true); end;

  -- ===== postgres: nakli kharch 5.00 (rollback me jayega) =====
  execute 'reset role';
  insert into public.campaign_spend_daily (campaign_id, day, spent) values (camp_a, current_date, 5.00);

  perform set_config('request.jwt.claims', json_build_object('sub', prof_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select to_jsonb(s) into j from public.get_my_campaign_spend(camp_a) s limit 1;
  res := res || jsonb_build_object('t','T6c owner reads own spend','expect','row with 5','got',coalesce(j::text,'no row'),'pass',j is not null);

  -- T7: KNOWN GAP: DB total budget (1) ko kharch (5) se neeche karne deta hai => app-level check (aur future DB trigger) zaroori
  begin update public.campaigns set total_budget = 1, daily_budget = null where id = camp_a;
    res := res || jsonb_build_object('t','T7 DB allows total budget below spend (known gap; app blocks it)','expect','success (known gap)','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','T7 DB allows total budget below spend (known gap; app blocks it)','expect','success','got',sqlstate||' '||sqlerrm,'pass',false); end;

  begin perform 1 from public.campaign_spend_daily limit 1;
    res := res || jsonb_build_object('t','T10 authenticated reads spend table directly','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T10 authenticated reads spend table directly','expect','error','got',sqlstate,'pass',true); end;

  -- ===== B (doosra advertiser) =====
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', prof_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.campaigns where id = camp_a;
  res := res || jsonb_build_object('t','T5a B sees A campaign','expect','0','got',n::text,'pass',n=0);
  update public.campaigns set name = 'HACKED' where id = camp_a;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('t','T5b B edits A campaign','expect','0 rows','got',n::text,'pass',n=0);
  begin delete from public.campaigns where id = camp_a;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('t','T5c B deletes A campaign','expect','0 rows or error','got',n::text,'pass',n=0);
  exception when others then res := res || jsonb_build_object('t','T5c B deletes A campaign','expect','0 rows or error','got',sqlstate,'pass',true); end;
  select count(*) into n from public.get_my_campaign_spend(camp_a);
  res := res || jsonb_build_object('t','T5d B reads A spend','expect','0 rows','got',n::text,'pass',n=0);

  -- ===== anon =====
  execute 'reset role';
  execute 'set local role anon';
  begin perform * from public.get_my_campaign_spend(camp_a);
    res := res || jsonb_build_object('t','T9 anon calls spend function','expect','error','got','success','pass',false);
  exception when others then res := res || jsonb_build_object('t','T9 anon calls spend function','expect','error','got',sqlstate,'pass',true); end;
  begin perform 1 from public.campaigns limit 1;
    res := res || jsonb_build_object('t','T9b anon reads campaigns','expect','error or 0 rows','got','success','pass',true);
  exception when others then res := res || jsonb_build_object('t','T9b anon reads campaigns','expect','error or 0 rows','got',sqlstate,'pass',true); end;

  execute 'reset role';
  raise exception 'DAY9_RESULTS %', res::text;   -- jaan-boojh kar error: poora transaction rollback
end $$;

-- Chalane ke baad (alag se) check: kuch save nahi hua?  Expect: test_rows_left = 0, spend_rows = pehle jitni
-- select (select count(*) from public.campaigns where name like 'ZZ%' or name = 'HACKED') as test_rows_left,
--        (select count(*) from public.campaign_spend_daily) as spend_rows;
