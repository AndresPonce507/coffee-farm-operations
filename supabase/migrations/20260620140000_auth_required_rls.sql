-- Single-owner app: gate ALL reads behind authentication.
-- Replaces the public "anon read" policies with "authenticated read", and revokes
-- the anon table grant so the REST API returns nothing to the public anon key.
-- This also closes the worker-phone PII exposure (anon can no longer read workers).

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'plots','workers','lots','harvests','processing_batches','tasks',
    'activity','weather','daily_cherries','weekly_harvest','variety_shares','season_summary'
  ]
  loop
    execute format('drop policy if exists "public read" on %I;', t);
    execute format(
      $p$create policy "authenticated read" on %I for select to authenticated using (true);$p$,
      t
    );
  end loop;
end $$;

-- Public/anon loses all read access (the security_invoker views follow suit).
revoke select on all tables in schema public from anon;

commit;
