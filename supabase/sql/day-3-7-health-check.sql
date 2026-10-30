-- =====================================================================
-- BLISSCCO | Day 3 | Part 7 : minimal health-check function
-- Pehle Part 1-5 chalne chahiye. Dobara chalane par safe hai (koi data nahi chhoota).
--
-- Ye function sirf `true` lautata hai. Koi table nahi padhta, koi data nahi dikhata.
-- /api/supabase-health isi ko bulata hai taaki pata chale ki database tak request pahunch rahi hai.
-- SECURITY INVOKER (default) + empty search_path => koi extra power nahi.
-- =====================================================================

create or replace function public.health_ping()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated;

-- Check (Expect: true):
--   select public.health_ping();
