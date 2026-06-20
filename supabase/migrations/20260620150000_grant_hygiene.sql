-- Defense-in-depth (auth red-team): RLS is the gate, but don't leave Supabase's
-- stock GRANTs as the only other thing standing between the public and the data.
-- This app is READ-ONLY, so no role needs write privileges; and future tables
-- must not be silently anon-readable (Postgres defaults new tables to RLS-off).

begin;

-- The app never writes — revoke leftover write grants from both roles.
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- Lock default privileges so a future table can't re-open the door:
--   anon gets nothing; authenticated gets no writes (it still reads via its
--   existing SELECT grant + the "authenticated read" RLS policies).
alter default privileges in schema public
  revoke select, insert, update, delete on tables from anon;
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

commit;
