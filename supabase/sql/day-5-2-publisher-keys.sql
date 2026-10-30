-- =====================================================================
-- BLISSCCO | Day 5 | Part 2 : publisher API keys
-- Pehle day-5-1 chali honi chahiye. Dobara chalane par safe hai.
--
-- Design notes
-- * Key ka PLAIN text kabhi database me nahi rehta; sirf SHA-256 hash (64 hex) aur
--   pehle 13 characters (key_prefix, pehchaan ke liye). Plain key sirf banate waqt EK baar dikhti hai.
-- * Key format: blc_live_ + 64 hex (lagbhag 244 bit random, DB ke gen_random_uuid se; koi extension nahi).
-- * Table par anon/authenticated/service_role ko koi grant nahi. Sab kuch niche ke functions se.
-- * Key banana/revoke karna abhi SQL Editor se (postgres role). Dashboard UI baad me.
-- * Ek publisher ke max 5 active keys.
-- =====================================================================

begin;

create table if not exists public.publisher_api_keys (
  id           uuid primary key default gen_random_uuid(),
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  key_prefix   text not null,
  key_hash     text not null,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,

  constraint publisher_api_keys_hash_key unique (key_hash),
  constraint publisher_api_keys_hash_check check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint publisher_api_keys_prefix_check check (char_length(key_prefix) between 8 and 20),
  constraint publisher_api_keys_status_check check (status in ('active', 'revoked')),
  constraint publisher_api_keys_revoked_check check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.publisher_api_keys is 'Publisher API keys (sirf hash). Plain key kabhi store nahi hoti.';

create index if not exists publisher_api_keys_publisher_idx on public.publisher_api_keys (publisher_id, status);

alter table public.publisher_api_keys enable row level security;
revoke all on table public.publisher_api_keys from public, anon, authenticated, service_role;

-- Key banao. Plain key ek baar return hoti hai: turant copy karo, kahin paste/share mat karo.
create or replace function private.issue_publisher_key(p_publisher_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not exists (select 1 from public.publishers p where p.id = p_publisher_id) then
    raise exception 'Publisher not found' using errcode = 'P0002';
  end if;

  if (select count(*) from public.publisher_api_keys k
      where k.publisher_id = p_publisher_id and k.status = 'active') >= 5 then
    raise exception 'Active key limit (5) reached. Revoke an old key first.' using errcode = '22023';
  end if;

  v_key := 'blc_live_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.publisher_api_keys (publisher_id, key_prefix, key_hash)
  values (p_publisher_id, left(v_key, 13), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));

  return v_key;
end;
$$;

-- Key band karo (key_id = publisher_api_keys.id, key nahi).
create or replace function private.revoke_publisher_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.publisher_api_keys
     set status = 'revoked', revoked_at = now()
   where id = p_key_id and status = 'active';
  if not found then
    raise exception 'Active key not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Sirf postgres (SQL Editor) chala sakta hai. API se (anon/authenticated/service_role) nahi.
revoke all on function private.issue_publisher_key(uuid)  from public, anon, authenticated, service_role;
revoke all on function private.revoke_publisher_key(uuid) from public, anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------
-- KEY BANANA (SQL Editor, apna publisher id daalo; publishers table me id dekh sakte ho):
--   select id, name, status from public.publishers;
--   select private.issue_publisher_key('PASTE-PUBLISHER-UUID-HERE');
-- Result me jo "blc_live_..." text aaye wahi key hai. Ek baar dikhti hai, dobara nahi nikal sakte.
-- Publisher ka status 'active' hona chahiye (warna key chalegi nahi). SQL Editor me:
--   update public.publishers set status = 'active' where id = 'PASTE-PUBLISHER-UUID-HERE';
--
-- KEYS DEKHNA (hash nahi dikhta, sirf prefix):
--   select id, key_prefix, status, created_at, last_used_at from public.publisher_api_keys
--   where publisher_id = 'PASTE-PUBLISHER-UUID-HERE' order by created_at;
--
-- KEY BAND KARNA (leak ho jaye toh turant):
--   select private.revoke_publisher_key('PASTE-KEY-ROW-ID-HERE');
-- ---------------------------------------------------------------------
