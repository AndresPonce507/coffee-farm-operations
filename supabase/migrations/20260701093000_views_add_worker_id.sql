-- Phase-5 view fix: expose worker_id in harvests_view and tasks_view.
--
-- Root cause: harvests_view and tasks_view joined workers on w.id = h/t.worker_id
-- to project w.name AS picker/assignee, but never selected the FK column itself.
-- The Phase-5 mappers (mapHarvest / mapTask) now read r.worker_id to build the
-- EntityLink drill-through to /workers/[id]. Because both getters call select("*"),
-- the omission means workerId is undefined for every row on a real DB, producing
-- dead /workers/undefined links despite the link-guard pattern in the UI.
--
-- Fix: CREATE OR REPLACE VIEW appending h.worker_id / t.worker_id as the LAST
-- column (Postgres REPLACE only allows new columns at the end of the list).
-- WITH (security_invoker = on) is preserved so the base-table RLS — including
-- the P4-S0 tenant_id policy — is enforced for the querying role unchanged.

begin;

create or replace view harvests_view with (security_invoker = on) as
  select h.id,
         h.date,
         h.plot_id,
         p.name     as plot_name,
         w.name     as picker,
         h.cherries_kg,
         h.ripeness_pct,
         h.brix_avg,
         h.lot_code,
         h.worker_id          -- appended: lets mapHarvest build a real EntityLink
  from harvests h
  join plots   p on p.id = h.plot_id
  join workers w on w.id = h.worker_id;

create or replace view tasks_view with (security_invoker = on) as
  select t.id,
         t.title,
         t.category,
         t.plot_id,
         p.name     as plot_name,
         w.name     as assignee,
         t.due,
         t.status,
         t.priority,
         t.worker_id          -- appended: lets mapTask build a real EntityLink
  from tasks t
  left join plots   p on p.id = t.plot_id
  join      workers w on w.id = t.worker_id;

-- Re-grant SELECT after the REPLACE (the AD-8 static guard requires every
-- migration that creates or replaces a view to carry an explicit GRANT SELECT
-- to authenticated within the same file — even though these views already held
-- the grant from the init migration, `create or replace view` re-creates the
-- object and the guard checks statically, not at runtime).
grant select on harvests_view to authenticated;
grant select on tasks_view    to authenticated;

commit;
