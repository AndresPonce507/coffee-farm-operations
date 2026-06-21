-- Owner-scoped RLS hardening (security audit, 2026-06-21).
--
-- The app is "single owner" but the policies encoded that as flat
-- `to authenticated using (true) with check (true)`, so RLS only separated anon
-- from authenticated — ANY authenticated principal had full read + write of all
-- worker PII, payroll, and EUDR data. Security therefore rested entirely on the
-- hosted project's signup toggle staying OFF.
--
-- This introduces an explicit membership allowlist and re-scopes every
-- UNCONDITIONAL policy to it. Access no longer depends on the signup setting: a
-- stranger who somehow obtains an account is not a member and sees/writes nothing.
-- Policies that already carry a real predicate (the min-wage make-whole guard,
-- the append-only event log, etc.) are left untouched.

begin;

-- 1. Membership allowlist ----------------------------------------------------
create table if not exists public.app_members (
  user_id  uuid primary key,
  added_at timestamptz not null default now()
);
alter table public.app_members enable row level security;

-- 2. Membership predicate ----------------------------------------------------
--    Reads the JWT subject directly: auth.uid() is platform-provided and absent
--    in the PGlite test substrate, so we read request.jwt.claims ourselves.
--    SECURITY DEFINER so the check can read app_members regardless of the
--    caller's own RLS; empty search_path + fully-qualified names per hardening.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_members m
    where m.user_id = nullif(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''
    )::uuid
  );
$$;
revoke execute on function public.is_member() from public;
grant execute on function public.is_member() to anon, authenticated;

-- members may read the member list; nobody writes it via the API (the owner
-- manages membership via SQL / the dashboard).
grant select on public.app_members to authenticated;
create policy "members read members" on public.app_members
  for select to authenticated using (public.is_member());

-- 3. Seed the owner ----------------------------------------------------------
--    Prod (Supabase) has auth.users -> enroll every existing user (the owner).
--    The PGlite test substrate has no auth schema -> enroll the harness's default
--    authenticated subject so the existing RLS tests keep passing. The hardcoded
--    uuid is NEVER inserted on prod (the auth.users branch runs there instead).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    insert into public.app_members (user_id)
    select id from auth.users
    on conflict (user_id) do nothing;
  else
    insert into public.app_members (user_id)
    values ('00000000-0000-0000-0000-000000000001')
    on conflict (user_id) do nothing;
  end if;
end $$;

-- 4. Re-scope every UNCONDITIONAL policy to membership ------------------------
--    Touches only policies whose predicate is literally `true`; each `true`
--    clause is replaced independently so a policy that mixes `using (true)` with
--    a real `with check` (or vice-versa) keeps its real clause.
do $$
declare
  r record;
  qual_open  boolean;
  check_open boolean;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'app_members'
  loop
    qual_open  := lower(btrim(coalesce(r.qual, '')))       = 'true';
    check_open := lower(btrim(coalesce(r.with_check, ''))) = 'true';

    if r.cmd in ('SELECT', 'DELETE') and qual_open then
      execute format('alter policy %I on public.%I using (public.is_member());',
                     r.policyname, r.tablename);

    elsif r.cmd = 'INSERT' and check_open then
      execute format('alter policy %I on public.%I with check (public.is_member());',
                     r.policyname, r.tablename);

    elsif r.cmd in ('UPDATE', 'ALL') then
      if qual_open and check_open then
        execute format('alter policy %I on public.%I using (public.is_member()) with check (public.is_member());',
                       r.policyname, r.tablename);
      elsif qual_open then
        execute format('alter policy %I on public.%I using (public.is_member());',
                       r.policyname, r.tablename);
      elsif check_open then
        execute format('alter policy %I on public.%I with check (public.is_member());',
                       r.policyname, r.tablename);
      end if;
    end if;
  end loop;
end $$;

commit;
