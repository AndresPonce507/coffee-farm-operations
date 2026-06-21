-- P2-S5 — Morning crew dispatch (ripeness-aware, bilingual shareable card).
--
-- Closes the loop from the maturation model (S8) and the crew system-of-record
-- (S1) to the picker's morning: at 5:30am the manager generates a per-crew
-- dispatch — "Crew Norte → plots X, Y ripe today, in pasada order" — delivered as a
-- bilingual (es / ngäbere) shareable card. The default $0 delivery is a web-share /
-- copy-link adapter (the device's native share sheet into the crew-lead WhatsApp
-- group, manually) — NOT the paid WhatsApp Cloud API (which is a dormant, flagged
-- drop-in behind the same ports-and-adapters seam).
--
-- ───────────────────────────────────────────────────────────────────────────
-- SCHEMA-TRUTH (matches the on-disk phase-1/phase-2 posture, NOT the design-doc
-- factory):
--   * The live spine is AUTHENTICATED-ONLY RLS — there is NO `app.apply_farm_rls`
--     factory and NO `farm_id` column anywhere in phases 1–2. This slice mirrors
--     the real posture: `enable row level security` + an "authenticated read"
--     policy + an explicit `grant select … to authenticated`. No farm_id /
--     multi-tenant (that lands later as P4-S0); no anon grants.
--   * The write door is the command RPC (ADR-002): SECURITY DEFINER, pinned
--     `set search_path = public, extensions`, idempotent on idempotency_key,
--     accepting the client-minted device_id/device_seq so every write is
--     offline-replayable through the S0 outbox. NO write table grants are issued.
--   * AD-8 grant hygiene: default privileges are locked, so EVERY new table/view
--     gets an explicit per-object `grant select … to authenticated`, and EVERY
--     function `revoke execute … from public` then `grant execute … to
--     authenticated`. Internal/trigger helpers get NO grant.
--   * Timestamp 20260622104000 sorts strictly above the S8 head
--     20260622100000_harvest_planning.sql — keep it (ASSIGNED).
--
-- DEPENDENCIES (all on disk, all phase-2 foundation):
--   * S1 (20260622090000_people_system): crews, crew_memberships, v_crew_roster.
--   * S8 (20260622100000_harvest_planning): v_harvest_readiness, pasada_schedule,
--     v_pasada_calendar — the ripeness-aware routing input generate_dispatch reads.
--
-- ───────────────────────────────────────────────────────────────────────────
-- 🚨 THE INJECTION INVARIANT (carried verbatim from the global no-untrusted-text-
-- drives-action rule, mirrored from the phase-1 brain): dispatch is OWNER-INITIATED
-- OUTBOUND ONLY. An inbound message (a crew-lead "got it" reply) is recorded ONLY as
-- EVIDENCE in dispatch_acknowledgement — it NEVER advances a run, fires a task,
-- mutates an assignment, or drives any command verb. The single inbound writer,
-- record_dispatch_ack, can reach ONLY the append-only acknowledgement ledger; it has
-- no path to generate_dispatch / mark_dispatch_sent / schedule_pasada / the tasks
-- board. The manager acts; untrusted text is never a puppeteer.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. dispatch_run — the morning's per-crew dispatch, APPEND-ONLY / SUPERSEDED.
--    Re-planning around a rain front (or a crew swap) writes a NEW run and stamps
--    the prior one 'superseded' (the morning's plan is forever auditable, never
--    edited away). `status` is the outbound lifecycle: draft → sent (owner action)
--    → acknowledged (evidence-derived, never auto). A run is the head a card renders.
-- ──────────────────────────────────────────────────────────────────────────
create table dispatch_run (
  id                  bigint generated always as identity primary key,
  crew_id             text        not null references crews(id),
  dispatch_date       date        not null,
  season              text        not null,
  readiness_threshold numeric     not null default 0.5
                        check (readiness_threshold >= 0 and readiness_threshold <= 1),
  status              text        not null default 'draft'
                        check (status in ('draft','sent','acknowledged','superseded')),
  sent_channel        text,                                   -- 'web-share' | 'copy-link' | 'whatsapp-cloud' | 'sms'
  sent_at             timestamptz,
  superseded_by       bigint      references dispatch_run(id),
  occurred_at         timestamptz not null,
  recorded_at         timestamptz not null default now(),
  device_id           text        not null,
  device_seq          bigint      not null,
  idempotency_key     text        unique,
  unique (device_id, device_seq)
);
create index dispatch_run_crew_idx   on dispatch_run (crew_id, dispatch_date);
create index dispatch_run_active_idx on dispatch_run (status) where status <> 'superseded';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. dispatch_assignment — the per-plot rows of a run: "this crew, this plot, this
--    pasada/ripeness band". APPEND-ONLY: an assignment is a snapshot of what the
--    model said at plan time (readiness + ripeness_target + the pasada it traces to)
--    so the card is reproducible. Re-planning makes a NEW run with NEW assignments;
--    the old run + its assignments stay as history.
-- ──────────────────────────────────────────────────────────────────────────
create table dispatch_assignment (
  id              bigint generated always as identity primary key,
  dispatch_run_id bigint      not null references dispatch_run(id),
  plot_id         text        not null references plots(id),
  pasada_id       bigint      references pasada_schedule(id),  -- the pasada this traces to (if any)
  task_kind       text        not null default 'picking',
  target_kg       numeric              check (target_kg is null or target_kg >= 0),
  ripeness_target text        not null default 'medium'
                    check (ripeness_target in ('low','medium','high')),
  readiness       numeric     not null check (readiness >= 0 and readiness <= 1),
  ord             integer     not null default 0,             -- pasada/readiness display order
  created_at      timestamptz not null default now()
);
create index dispatch_assignment_run_idx on dispatch_assignment (dispatch_run_id, ord);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. dispatch_acknowledgement — the INBOUND EVIDENCE ledger. APPEND-ONLY. The ONLY
--    thing an inbound "got it" reply may write. It records THAT the crew lead saw
--    the dispatch (proof), never an action. record_dispatch_ack is its sole writer;
--    it can reach NOTHING else. (The injection invariant, in table form: untrusted
--    inbound text lands here as evidence and stops.)
-- ──────────────────────────────────────────────────────────────────────────
create table dispatch_acknowledgement (
  id              bigint generated always as identity primary key,
  dispatch_run_id bigint      not null references dispatch_run(id),
  worker_id       text        references workers(id),         -- the crew lead who acked (nullable: unknown sender)
  channel         text        not null,                       -- 'whatsapp-inbound' | 'sms-inbound' | 'manual'
  note            text,                                       -- a free-text inbound snippet, EVIDENCE ONLY — never parsed for action
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  device_id       text        not null,
  device_seq      bigint      not null,
  idempotency_key text        unique,
  unique (device_id, device_seq)
);
create index dispatch_ack_run_idx on dispatch_acknowledgement (dispatch_run_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. dispatch_outbound — the ports-and-adapters delivery QUEUE (the phase-1 EUDR
--    `outbound_deliveries` pattern). A message to be delivered, behind an adapter so
--    the CHANNEL is swappable. The default $0 channel is 'web-share' (resolved at the
--    app layer to the native share sheet); 'whatsapp-cloud' is a DORMANT, flagged
--    drop-in. Enqueued by mark_dispatch_sent; the app-layer flush adapter drains it.
-- ──────────────────────────────────────────────────────────────────────────
create table dispatch_outbound (
  id              bigint generated always as identity primary key,
  dispatch_run_id bigint      not null references dispatch_run(id),
  channel         text        not null
                    check (channel in ('web-share','copy-link','whatsapp-cloud','sms')),
  status          text        not null default 'pending'
                    check (status in ('pending','delivered','failed')),
  payload         jsonb       not null default '{}'::jsonb,
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  idempotency_key text        unique
);
create index dispatch_outbound_run_idx on dispatch_outbound (dispatch_run_id, status);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Append-only guards. dispatch_run allows the ONE sanctioned UPDATE family —
--    the outbound lifecycle (draft→sent, sent→acknowledged) and the supersede stamp
--    — and rejects everything else (re-keying a crew/date, un-superseding). The
--    assignment + acknowledgement + outbound ledgers are stricter: an assignment and
--    an acknowledgement never change; outbound moves pending→delivered/failed only.
-- ──────────────────────────────────────────────────────────────────────────

-- dispatch_run: sanctioned mutations only (lifecycle forward + supersede stamp).
-- Append-only is enforced at the DATA LAYER (not merely by the absence of a write
-- grant): EVERY column except the four lifecycle/supersede columns is frozen, a
-- superseded row is TERMINAL (never re-edited), and a same-status UPDATE that touches
-- any non-sanctioned column raises — so the same-status branch can never be a window
-- to rewrite a frozen plan input (readiness_threshold, channel-before-send, etc.).
create or replace function dispatch_run_guard() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dispatch_run is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;

  -- a superseded run is HISTORY — terminal, never rewritten (the supersede link and
  -- every other column are frozen forever once a run is superseded).
  if old.status = 'superseded' then
    raise exception 'dispatch_run is append-only: a superseded run is terminal history and is immutable'
      using errcode = 'restrict_violation';
  end if;

  -- the identity + plan inputs of a run are FROZEN. Only status / sent_channel /
  -- sent_at / superseded_by may EVER change (and only via the transitions below).
  if new.crew_id            is distinct from old.crew_id
     or new.dispatch_date   is distinct from old.dispatch_date
     or new.season          is distinct from old.season
     or new.readiness_threshold is distinct from old.readiness_threshold
     or new.occurred_at      is distinct from old.occurred_at
     or new.recorded_at      is distinct from old.recorded_at
     or new.device_id        is distinct from old.device_id
     or new.device_seq       is distinct from old.device_seq
     or new.idempotency_key  is distinct from old.idempotency_key then
    raise exception 'dispatch_run identity + plan inputs are immutable — re-plan with a NEW run'
      using errcode = 'restrict_violation';
  end if;

  -- the supersede stamp: an active run -> superseded, superseded_by set. No other
  -- column may move in the same write (the freeze above already guarantees that;
  -- sent_channel/sent_at are not part of a supersede).
  if new.status = 'superseded' then
    if new.superseded_by is null then
      raise exception 'dispatch_run: a supersede must set superseded_by'
        using errcode = 'restrict_violation';
    end if;
    if new.sent_channel is distinct from old.sent_channel
       or new.sent_at is distinct from old.sent_at then
      raise exception 'dispatch_run: a supersede may not also change the send columns'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  -- the outbound lifecycle forward: draft -> sent (stamps channel/sent_at), or
  -- sent -> acknowledged. superseded_by stays null on a lifecycle move.
  if new.superseded_by is distinct from old.superseded_by then
    raise exception 'dispatch_run: superseded_by may only be set by a supersede'
      using errcode = 'restrict_violation';
  end if;
  if (old.status = 'draft' and new.status = 'sent')
     or (old.status = 'sent' and new.status = 'acknowledged') then
    return new;
  end if;
  -- a true no-op (status unchanged) is allowed ONLY when nothing else moved either —
  -- but on a 'sent' run a re-send may (idempotently) keep sent_channel populated.
  if old.status = new.status then
    if old.status = 'sent'
       and new.dispatch_date = old.dispatch_date then  -- (frozen cols already checked above)
      return new;  -- a sent-run re-send touching only sent_channel is idempotent
    end if;
    if new.sent_channel is not distinct from old.sent_channel
       and new.sent_at is not distinct from old.sent_at then
      return new;  -- genuine no-op
    end if;
    raise exception 'dispatch_run is append-only: the send columns may only change on the draft→sent transition (blocked)'
      using errcode = 'restrict_violation';
  end if;
  raise exception 'dispatch_run: only the outbound lifecycle (draft→sent→acknowledged) or the supersede stamp may UPDATE (% → % blocked)', old.status, new.status
    using errcode = 'restrict_violation';
end $$;
create trigger dispatch_run_no_delete before delete on dispatch_run
  for each row execute function dispatch_run_guard();
create trigger dispatch_run_sanctioned_update before update on dispatch_run
  for each row execute function dispatch_run_guard();

-- dispatch_assignment: fully immutable (a snapshot; correct by a new run).
create or replace function dispatch_assignment_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception 'dispatch_assignment is append-only: % is not permitted — re-plan with a new run', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger dispatch_assignment_no_update before update on dispatch_assignment
  for each row execute function dispatch_assignment_immutable();
create trigger dispatch_assignment_no_delete before delete on dispatch_assignment
  for each row execute function dispatch_assignment_immutable();

-- dispatch_acknowledgement: fully immutable (inbound EVIDENCE is never rewritten).
create or replace function dispatch_ack_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception 'dispatch_acknowledgement is append-only EVIDENCE: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger dispatch_ack_no_update before update on dispatch_acknowledgement
  for each row execute function dispatch_ack_immutable();
create trigger dispatch_ack_no_delete before delete on dispatch_acknowledgement
  for each row execute function dispatch_ack_immutable();

-- dispatch_outbound: append-only except the delivery status transition. Every column
-- except `status` is frozen, and only the pending→delivered/failed move is allowed —
-- a same-status write that changes any other column (payload, etc.) raises.
create or replace function dispatch_outbound_guard() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dispatch_outbound is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;
  -- everything except `status` is frozen.
  if new.dispatch_run_id is distinct from old.dispatch_run_id
     or new.channel       is distinct from old.channel
     or new.payload       is distinct from old.payload
     or new.occurred_at    is distinct from old.occurred_at
     or new.recorded_at    is distinct from old.recorded_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'dispatch_outbound is append-only: only the delivery status may change'
      using errcode = 'restrict_violation';
  end if;
  -- a delivered/failed row is terminal.
  if old.status in ('delivered','failed') and new.status is distinct from old.status then
    raise exception 'dispatch_outbound: a delivered/failed delivery is terminal'
      using errcode = 'restrict_violation';
  end if;
  if (old.status = 'pending' and new.status in ('delivered','failed'))
     or new.status = old.status then
    return new;
  end if;
  raise exception 'dispatch_outbound: only pending→delivered/failed may UPDATE'
    using errcode = 'restrict_violation';
end $$;
create trigger dispatch_outbound_no_delete before delete on dispatch_outbound
  for each row execute function dispatch_outbound_guard();
create trigger dispatch_outbound_status_only before update on dispatch_outbound
  for each row execute function dispatch_outbound_guard();

-- ──────────────────────────────────────────────────────────────────────────
-- 6. v_dispatch_today — the ACTIVE (non-superseded) run per crew for today, joined
--    to the crew name. The /dispatch board reads this. security_invoker so base-
--    table RLS governs the caller.
-- ──────────────────────────────────────────────────────────────────────────
create view v_dispatch_today with (security_invoker = on) as
  select
    r.id,
    r.crew_id,
    c.name            as crew_name,
    r.dispatch_date,
    r.season,
    r.status,
    r.sent_channel,
    r.sent_at,
    r.readiness_threshold,
    r.idempotency_key,
    r.recorded_at
  from dispatch_run r
  join crews c on c.id = r.crew_id
  where r.status <> 'superseded';

-- v_dispatch_card — one renderable card row per active run: crew, date, status, and
-- the plot_count (how many plots the card lists). The card preview header reads this.
create view v_dispatch_card with (security_invoker = on) as
  select
    r.id,
    r.crew_id,
    c.name            as crew_name,
    r.dispatch_date,
    r.season,
    r.status,
    r.sent_channel,
    r.readiness_threshold,
    r.idempotency_key,
    (select count(*) from dispatch_assignment a where a.dispatch_run_id = r.id) as plot_count
  from dispatch_run r
  join crews c on c.id = r.crew_id
  where r.status <> 'superseded';

-- v_dispatch_card_plots — the per-plot lines of every active run's card, joined to
-- the plot name + variety + altitude so the card renders "Norte Bajo (Catuaí,
-- 1,400 masl)" in pasada/readiness order. security_invoker.
create view v_dispatch_card_plots with (security_invoker = on) as
  select
    a.id,
    a.dispatch_run_id,
    a.plot_id,
    p.name          as plot_name,
    p.variety,
    p.altitude_masl,
    a.task_kind,
    a.target_kg,
    a.ripeness_target,
    a.readiness,
    a.ord
  from dispatch_assignment a
  join plots p on p.id = a.plot_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. generate_dispatch — the command door. Reads v_harvest_readiness (S8) for the
--    crew's plots-ready-today (readiness >= threshold), creates a DRAFT run, and
--    appends one dispatch_assignment per ready plot (snapshotting readiness +
--    ripeness band + the active pasada it traces to, in readiness order). If a
--    prior ACTIVE run exists for this crew+date, it is SUPERSEDED (append-only). One
--    idempotent SECURITY DEFINER txn. NEVER auto-sends — the run starts 'draft'.
--
--    Plot scoping: there is no plot↔crew assignment table in the live spine yet, so
--    a crew dispatches over ALL ready plots (the manager curates on the board). When
--    a crew↔plot map lands (a later slice), this filters to the crew's plots — the
--    contract (ready plots, in order) is unchanged.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function generate_dispatch(
  p_crew_id             text,
  p_dispatch_date       date,
  p_season              text,
  p_readiness_threshold numeric,
  p_occurred_at         timestamptz,
  p_device_id           text,
  p_device_seq          bigint,
  p_idempotency_key     text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  existing_id bigint;
  current_id  bigint;
  run_id      bigint;
  thr         numeric;
  rec         record;
  pos         integer := 0;
begin
  -- exactly-once
  select id into existing_id from dispatch_run where idempotency_key = p_idempotency_key;
  if existing_id is not null then
    return existing_id;
  end if;

  if not exists (select 1 from crews where id = p_crew_id) then
    raise exception 'unknown crew %', p_crew_id using errcode = 'foreign_key_violation';
  end if;

  thr := coalesce(p_readiness_threshold, 0.5);

  -- the current ACTIVE run being superseded (may be none on the first dispatch).
  select id into current_id
    from dispatch_run
   where crew_id = p_crew_id and dispatch_date = p_dispatch_date and status <> 'superseded'
   order by recorded_at desc
   limit 1;

  insert into dispatch_run (crew_id, dispatch_date, season, readiness_threshold,
                            status, occurred_at, device_id, device_seq, idempotency_key)
  values (p_crew_id, p_dispatch_date, p_season, thr,
          'draft', p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  returning id into run_id;

  -- one assignment per plot at/above the readiness threshold, in readiness order
  -- (most-ready first — the pasada wave down the altitude gradient). The ripeness
  -- band is bucketed from the derived readiness; the active pasada (if any) is
  -- traced for the card's "pasada N" line.
  for rec in
    select
      hr.plot_id,
      hr.readiness,
      case
        when hr.readiness >= 0.8 then 'high'
        when hr.readiness >= 0.45 then 'medium'
        else 'low'
      end as ripeness_target,
      (select pc.id
         from v_pasada_calendar pc
        where pc.plot_id = hr.plot_id and pc.status <> 'superseded'
        order by pc.predicted_ready_date asc
        limit 1) as pasada_id
    from v_harvest_readiness hr
    where hr.readiness >= thr
    order by hr.readiness desc, hr.plot_id
  loop
    pos := pos + 1;
    insert into dispatch_assignment (dispatch_run_id, plot_id, pasada_id, task_kind,
                                     ripeness_target, readiness, ord)
    values (run_id, rec.plot_id, rec.pasada_id, 'picking',
            rec.ripeness_target, rec.readiness, pos);
  end loop;

  -- supersede the prior active run AFTER the new one + its assignments exist.
  if current_id is not null then
    update dispatch_run
       set status = 'superseded', superseded_by = run_id
     where id = current_id;
  end if;

  return run_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. mark_dispatch_sent — the OWNER-INITIATED OUTBOUND transition. Moves a draft run
--    to 'sent', stamps the channel + sent_at, and enqueues a dispatch_outbound row
--    (the adapter the app-layer flush drains). Idempotent on idempotency_key.
--    This is the deliberate "share the card" action; generation never reaches it.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function mark_dispatch_sent(
  p_run_id          bigint,
  p_channel         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare cur text;
begin
  -- exactly-once: a replay with the same key does not double-send.
  if exists (select 1 from dispatch_outbound where idempotency_key = p_idempotency_key) then
    return p_run_id;
  end if;

  select status into cur from dispatch_run where id = p_run_id;
  if cur is null then
    raise exception 'unknown dispatch run %', p_run_id using errcode = 'foreign_key_violation';
  end if;

  -- enqueue the outbound delivery (the $0 web-share adapter resolves it at the app
  -- layer; whatsapp-cloud is a dormant, flagged channel).
  insert into dispatch_outbound (dispatch_run_id, channel, status, occurred_at, idempotency_key)
  values (p_run_id, coalesce(p_channel, 'web-share'), 'pending', p_occurred_at, p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  -- transition the run to 'sent' (idempotent: a re-send on an already-sent run is a
  -- no-op on the status but still stamps the channel if it was null).
  if cur = 'draft' then
    update dispatch_run
       set status = 'sent', sent_channel = coalesce(p_channel, 'web-share'), sent_at = p_occurred_at
     where id = p_run_id;
  elsif cur = 'sent' then
    update dispatch_run
       set sent_channel = coalesce(sent_channel, p_channel, 'web-share')
     where id = p_run_id;
  end if;

  return p_run_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. record_dispatch_ack — 🚨 THE INJECTION-SAFE INBOUND WRITER. The ONLY thing an
--    inbound "got it" reply may do: append ONE dispatch_acknowledgement EVIDENCE
--    row. It does NOT advance the run, fire a task, mutate an assignment, or reach
--    any command verb. The `note` is stored verbatim as evidence and is NEVER parsed
--    for action. The run's status only ever becomes 'acknowledged' if the OWNER
--    chooses to (a separate UI action) — never automatically from an inbound here.
--    Idempotent on idempotency_key (a replayed inbound is one evidence row).
-- ──────────────────────────────────────────────────────────────────────────
create or replace function record_dispatch_ack(
  p_run_id          bigint,
  p_worker_id       text,
  p_channel         text,
  p_occurred_at     timestamptz,
  p_device_id       text,
  p_device_seq      bigint,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare new_id bigint;
begin
  -- exactly-once
  if exists (select 1 from dispatch_acknowledgement where idempotency_key = p_idempotency_key) then
    select id into new_id from dispatch_acknowledgement where idempotency_key = p_idempotency_key;
    return new_id;
  end if;

  if not exists (select 1 from dispatch_run where id = p_run_id) then
    raise exception 'unknown dispatch run %', p_run_id using errcode = 'foreign_key_violation';
  end if;

  -- EVIDENCE ONLY. No status change, no task, no assignment. This is the entire body
  -- of the inbound path — by construction it cannot drive an action.
  insert into dispatch_acknowledgement (dispatch_run_id, worker_id, channel,
                                        occurred_at, device_id, device_seq, idempotency_key)
  values (p_run_id, p_worker_id, p_channel, p_occurred_at, p_device_id, p_device_seq, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from dispatch_acknowledgement where idempotency_key = p_idempotency_key;
  end if;

  return new_id;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 10. RLS — authenticated-only read on the new tables (mirrors auth_required_rls).
--     No write policy: writes go only through the SECURITY DEFINER RPCs above. The
--     append-only EVIDENCE ledgers `force` RLS so even the owner reads via policy.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'dispatch_run','dispatch_assignment','dispatch_acknowledgement','dispatch_outbound'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "authenticated read" on %I for select to authenticated using (true);$p$, t);
  end loop;
end $$;

alter table dispatch_acknowledgement force row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 11. GRANTS (AD-8) — explicit per-object SELECT on every new table/view; explicit
--     EXECUTE only on the caller-facing RPCs (revoke public first); NO write table
--     grants; NO anon. Trigger/guard helpers get NO grant.
-- ──────────────────────────────────────────────────────────────────────────
grant select on dispatch_run             to authenticated;
grant select on dispatch_assignment      to authenticated;
grant select on dispatch_acknowledgement to authenticated;
grant select on dispatch_outbound        to authenticated;
grant select on v_dispatch_today         to authenticated;
grant select on v_dispatch_card          to authenticated;
grant select on v_dispatch_card_plots    to authenticated;

revoke execute on function dispatch_run_guard()            from public;
revoke execute on function dispatch_assignment_immutable() from public;
revoke execute on function dispatch_ack_immutable()        from public;
revoke execute on function dispatch_outbound_guard()       from public;
revoke execute on function generate_dispatch(text, date, text, numeric, timestamptz, text, bigint, text)   from public;
revoke execute on function mark_dispatch_sent(bigint, text, timestamptz, text, bigint, text)               from public;
revoke execute on function record_dispatch_ack(bigint, text, text, timestamptz, text, bigint, text)        from public;

grant execute on function generate_dispatch(text, date, text, numeric, timestamptz, text, bigint, text)   to authenticated;
grant execute on function mark_dispatch_sent(bigint, text, timestamptz, text, bigint, text)               to authenticated;
grant execute on function record_dispatch_ack(bigint, text, text, timestamptz, text, bigint, text)        to authenticated;

commit;
