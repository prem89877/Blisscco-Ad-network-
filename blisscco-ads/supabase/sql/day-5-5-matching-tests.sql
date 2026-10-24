-- =====================================================================
-- BLISSCCO | Day 5 | Part 5 : matching engine ke SQL tests
-- Ye tests tab tak "pass" nahi maane jaate jab tak tumne khud run karke expected result na dekha ho.
--
-- Pehle: day-5-1 se day-5-4 chali hon, aur day-3-6 ka SETUP block chala ho
-- (TEST Publisher C, TEST Campaign A/B, TEST creative A/B, users janvi01506 (A) / sanjaytalekar740 (B) / delieveryboy09 (Publisher C)).
-- Har TEST block ALAG se chalao (editor saaf karke ek block paste karo).
-- Har block begin...rollback me hai, kuch save nahi hota. "ERROR" kai tests me EXPECTED hai.
-- Sirf test project par chalao. Poori file ek saath RUN mat karna.
--
-- Har block ka PREP: key banata hai (sirf transaction me), TEST Campaign A ko gaming + active karta hai,
-- TEST creative A ko approved karta hai. Phir match function service_role ki tarah chalta hai.
-- =====================================================================


-- ===================== M1 (permitted): gaming topic par approved creative milta hai =====================
-- Expect: outcome = ok, ad.headline = TEST creative A (ya B nahi, kyunki B abhi draft hai)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M2 (forbidden): galat/anjaan key =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(repeat('0', 64), 'gaming', '{}') as result;
rollback;


-- ===================== M3 (no fill): topic mismatch (campaign gaming hai, request technology) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'technology', '{}') as result;
rollback;


-- ===================== M4 (no fill): taxonomy se bahar / sensitive topic =====================
-- Expect: outcome = no_fill (health, politics jaisi cheezein list me hain hi nahi)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'health', '{}') as result;
rollback;


-- ===================== M5 (no fill): inactive (legacy) category 'beauty' =====================
-- Expect: outcome = no_fill, chahe campaign beauty par ho
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set category = 'beauty' where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'beauty', '{}') as result;
rollback;


-- ===================== M6 (no fill): paused campaign =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set status = 'paused' where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M7 (no fill): end_date guzar chuki (campaign abhi 'active' hai) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set start_date = current_date - 5, end_date = current_date - 1 where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M8 (no fill): start_date kal ki hai (scheduled-out) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set start_date = current_date + 1 where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M9 (no fill): advertiser suspended (campaign status active hi hai) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.advertisers set status = 'suspended' where company_name = 'TEST Advertiser A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M10 (no fill): advertiser ka profile suspended =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.profiles set status = 'suspended' where id = (select id from auth.users where email = 'janvi01506@gmail.com');
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M11 (no fill): creative approved nahi (pending_review) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.ad_creatives set status = 'pending_review', reviewed_at = null where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M12 (no fill): total budget khatam (kharch = total_budget) =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
insert into public.campaign_spend_daily (campaign_id, day, spent) select id, current_date - 3, total_budget from public.campaigns where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M13 (no fill): aaj ka daily budget khatam =====================
-- Expect: outcome = no_fill
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set daily_budget = 10 where name = 'TEST Campaign A';
insert into public.campaign_spend_daily (campaign_id, day, spent) select id, (now() at time zone 'utc')::date, 10 from public.campaigns where name = 'TEST Campaign A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M14 (permitted): rotation: exclude ke baad doosra creative (A aur B dono eligible) =====================
-- Expect: outcome = ok, ad.headline = TEST creative B (A exclude kiya).
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign B';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative B';
select set_config('test.a', (select x.id::text from public.ad_creatives x where x.headline = 'TEST creative A'), true);
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', array[current_setting('test.a')::uuid]) as result;
rollback;


-- ===================== M15 (permitted): rotation: dono exclude => alternative nahi, toh repeat allowed =====================
-- Expect: outcome = ok (A ya B, dono me se koi)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign B';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative B';
select set_config('test.a', (select x.id::text from public.ad_creatives x where x.headline = 'TEST creative A'), true);
select set_config('test.b', (select x.id::text from public.ad_creatives x where x.headline = 'TEST creative B'), true);
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', array[current_setting('test.a')::uuid, current_setting('test.b')::uuid]) as result;
rollback;


-- ===================== M16 (permitted): fairness: pehle serve ho chuke campaign ki jagah kam serve hua campaign pehle =====================
-- Expect: outcome = ok, ad.headline = TEST creative B (A aaj 5 baar serve ho chuka hai)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign B';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative B';
insert into public.creative_serve_daily (creative_id, campaign_id, day, serves) select x.id, x.campaign_id, (now() at time zone 'utc')::date, 5 from public.ad_creatives x where x.headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M17 (permitted): response me sirf public fields =====================
-- Expect: keys = body, cta_text, destination_url, headline, id (advertiser/budget/campaign kuch nahi)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select array(select jsonb_object_keys(r.result -> 'ad') order by 1) as ad_keys
from (select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result) r;
rollback;


-- ===================== M18 (permitted): serve log me prompt/IP nahi, sirf publisher+creative+topic =====================
-- Expect: serves_logged = 1, topic = gaming. Columns me koi prompt/ip/user column nahi (columns list dekho).
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}');
reset role;
select (select count(*) from public.ad_serve_log) as serves_logged,
       (select topic from public.ad_serve_log limit 1) as topic,
       (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'ad_serve_log') as columns;
rollback;


-- ===================== M19 (permitted): rate limit: limit 2 => teesri call rate_limited =====================
-- Expect: {ok,ok,rate_limited}
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.ad_platform_settings set rate_limit_per_minute = 2;
set local role service_role;
select array_agg(public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') ->> 'outcome' order by g) as outcomes
from generate_series(1, 3) g;
rollback;


-- ===================== M20 (forbidden): revoked key =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
select private.revoke_publisher_key((select id from public.publisher_api_keys where key_hash = current_setting('test.hash')));
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M21 (forbidden): publisher suspended =====================
-- Expect: outcome = unauthorized
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.publishers set status = 'suspended' where name = 'TEST Publisher C';
set local role service_role;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}') as result;
rollback;


-- ===================== M22 (forbidden): logged-in user (authenticated) function nahi chala sakta =====================
-- Expect: ERROR permission denied for function match_contextual_ad
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role authenticated;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}');
rollback;


-- ===================== M23 (forbidden): anon function nahi chala sakta =====================
-- Expect: ERROR permission denied for function match_contextual_ad
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role anon;
select public.match_contextual_ad(current_setting('test.hash'), 'gaming', '{}');
rollback;


-- ===================== M24 (forbidden): authenticated user keys table nahi padh sakta =====================
-- Expect: ERROR permission denied for table publisher_api_keys
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role authenticated;
select * from public.publisher_api_keys;
rollback;


-- ===================== M25 (forbidden): service_role bhi keys table seedha nahi padh sakta (sirf function ke zariye) =====================
-- Expect: ERROR permission denied for table publisher_api_keys
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select * from public.publisher_api_keys;
rollback;


-- ===================== M26 (forbidden): campaign ki category taxonomy se bahar nahi ja sakti (foreign key) =====================
-- Expect: ERROR violates foreign key constraint campaigns_category_fk
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
update public.campaigns set category = 'not_a_category' where name = 'TEST Campaign A';
rollback;


-- ===================== M27 (forbidden): service_role key banane ka function nahi chala sakta =====================
-- Expect: ERROR permission denied (for schema private ya function issue_publisher_key; dono sahi hain)
begin;
select set_config('test.key', private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C')), true);
select set_config('test.hash', encode(sha256(convert_to(current_setting('test.key'), 'UTF8')), 'hex'), true);
update public.campaigns set category = 'gaming', status = 'active' where name = 'TEST Campaign A';
update public.ad_creatives set status = 'approved', reviewed_at = now() where headline = 'TEST creative A';
set local role service_role;
select private.issue_publisher_key((select id from public.publishers where name = 'TEST Publisher C'));
rollback;
