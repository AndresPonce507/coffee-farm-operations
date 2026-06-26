-- ════════════════════════════════════════════════════════════════════════════
-- P3-S19 · Reputation ledger — cup scores / awards / certs bound to a lot.
-- ════════════════════════════════════════════════════════════════════════════
-- Spec: docs/design/PHASE3-DESIGN.md lines 403–410 (+ §1 cross-slice rails).
-- Depends (HARD): Phase-1 lots (the composite (tenant_id, code) PK after P4-S0);
--                 lot_event / record_lot_event / event_set_hash / verify_chain /
--                 lot_code_seq. Soft: P2-S6 cupping_sessions (source_session_id is a
--                 soft, un-FK'd-by-name reference — cupping ships before OR after this).
--                 Reconciles against green_lots.sca_grade / cupping_score (the QC truth).
--
-- WHAT THIS SLICE DOES, all test-first (src/test/db/s19_reputation.db.test.ts):
--
--  1. ADDS lot_accolades — an APPEND-ONLY, HASH-CHAINED reputation ledger keyed to a
--     lot via the composite (tenant_id, lot_code) -> lots(tenant_id, code) FK. A cup
--     score, award, certification, or press mention is an immutable accolade. A revision
--     or retraction is a 'score-revision' REVERSING row (reverses_id), NEVER an edit —
--     the cost_entry/revenue_entry correction idiom. Its own per-lot hash chain
--     ('accolade:<lot_code>') reuses the shared event_set_hash; verify_chain gains an
--     'accolade:%' branch (additive — every other branch is verbatim).
--
--  2. The keystone invariant: a cup-score MUST carry a score in [0,100] (CHECK), and an
--     accolade can't claim a non-existent lot (FK). Append-only at the data layer (the
--     owner cannot UPDATE/DELETE either — a correction is a superseding revision row).
--
--  3. Read views — v_lot_reputation (net live accolades excluding the reversed, best cup
--     score, awards/certs/press counts, reconciled to green_lots.sca_grade/cupping_score)
--     and v_lot_reputation_public (the NARROW title/score/awarded_by/award_year public
--     projection — granted to AUTHENTICATED ONLY here; P3-S13 grants it to anon).
--
-- Rails honored (§1): one write door (record_accolade / revise_accolade are SECURITY
-- DEFINER, set search_path = public, extensions, tenant-clamped, idempotent on a
-- tenant-qualified key, appending a lot_event onto the lot's provenance chain in the SAME
-- txn). AD-8/AD-9 grants exactly (per-object grant select to authenticated; revoke-then-
-- grant on every caller-facing RPC; internal trigger fns revoke-from-public NO grant;
-- anon gets NOTHING). Tenant seam (tenant_id + current_tenant_id() default + RLS on the
-- new table). No untrusted inbound drives a write (accolades are owner-authored evidence).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Enum — the accolade vocabulary.
-- ════════════════════════════════════════════════════════════════════════════
create type accolade_kind as enum
  ('cup-score', 'award', 'certification', 'press-mention', 'score-revision');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. lot_accolades — the APPEND-ONLY, HASH-CHAINED reputation ledger. Keyed to the
--    lot via the composite (tenant_id, lot_code) FK. payload mirrors the business
--    columns so the per-lot hash chain ('accolade:<lot_code>') tamper-protects the
--    accolade content (same shape as contact_events). reverses_id binds a revision to
--    the row it supersedes (self-FK; same-tenant/lot enforced in revise_accolade).
-- ════════════════════════════════════════════════════════════════════════════
create table lot_accolades (
  id                bigint generated always as identity primary key,
  tenant_id         uuid    not null references tenants(id) default current_tenant_id(),
  lot_code          text    not null,
  kind              accolade_kind not null,
  title             text,
  score             numeric,
  awarded_by        text,
  award_year        int,
  evidence_url      text,
  source_session_id bigint,                                 -- soft ref to cupping_sessions (un-FK'd by name)
  reverses_id       bigint  references lot_accolades(id),   -- a revision/retraction reverses this row
  stream_key        text    not null,                       -- 'accolade:<lot_code>'
  payload           jsonb   not null default '{}'::jsonb
                      check (octet_length(payload::text) < 4096),
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  device_id         text    not null,
  device_seq        bigint  not null,
  prev_hash         bytea,
  hash              bytea,
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  constraint lot_accolades_green_lot_tfk
    foreign key (tenant_id, lot_code) references lots(tenant_id, code),
  -- a cup score (and its revision) MUST carry a score in [0,100]; other kinds may not.
  constraint lot_accolades_cupscore_chk
    check (kind not in ('cup-score', 'score-revision')
           or (score is not null and score >= 0 and score <= 100)),
  -- a score-revision is meaningless without the row it reverses.
  constraint lot_accolades_revision_chk
    check (kind <> 'score-revision' or reverses_id is not null),
  -- only a score-revision may carry reverses_id (every other kind is an original).
  constraint lot_accolades_reverses_only_revision_chk
    check (reverses_id is null or kind = 'score-revision'),
  constraint lot_accolades_award_year_chk
    check (award_year is null or (award_year between 1900 and 2200)),
  constraint lot_accolades_devseq_ux unique (device_id, device_seq),
  constraint lot_accolades_tenant_idem_ux unique (tenant_id, idempotency_key)
);
create index lot_accolades_tenant_idx   on lot_accolades (tenant_id);
create index lot_accolades_lot_idx       on lot_accolades (tenant_id, lot_code);
create index lot_accolades_stream_idx    on lot_accolades (stream_key, device_seq);
create index lot_accolades_reverses_idx  on lot_accolades (reverses_id) where reverses_id is not null;

-- hash trigger (tenant assert + tenant-scoped head-select; delegates to event_set_hash).
create or replace function _lot_accolade_set_hash() returns trigger
  language plpgsql
  set search_path = public, extensions
as $$
declare head bytea;
begin
  if new.tenant_id is distinct from current_tenant_id() then
    raise exception 'ledger tenant_id % does not match session tenant', new.tenant_id
      using errcode = 'insufficient_privilege';
  end if;
  select e.hash into head from lot_accolades e
   where e.stream_key = new.stream_key and e.tenant_id = new.tenant_id
   order by e.device_seq desc limit 1;
  new.prev_hash := head;
  new.hash := event_set_hash(new.prev_hash, new.stream_key, new.kind::text, new.payload,
                             new.occurred_at, new.device_id, new.device_seq);
  return new;
end $$;
create trigger lot_accolades_set_hash before insert on lot_accolades
  for each row execute function _lot_accolade_set_hash();
revoke execute on function _lot_accolade_set_hash() from public;

-- immutability — append-only at the data layer (a correction is a superseding
-- 'score-revision' row, never an edit). Leading-underscore trigger fn (no grant).
create or replace function _lot_accolades_immutable() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  raise exception
    'lot_accolades is append-only: % is not permitted — post a score-revision reversing row instead', tg_op
    using errcode = 'restrict_violation';
end $$;
create trigger lot_accolades_no_update before update on lot_accolades
  for each row execute function _lot_accolades_immutable();
create trigger lot_accolades_no_delete before delete on lot_accolades
  for each row execute function _lot_accolades_immutable();
revoke execute on function _lot_accolades_immutable() from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. verify_chain — gains an 'accolade:%' branch (additive; every other branch verbatim
--    from 20260708090000_crm_contacts.sql) so a lot's reputation chain is verifiable
--    just like its provenance / a contact's timeline.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function verify_chain(stream_key text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant    uuid := current_tenant_id();
  r           record;
  expect_prev bytea := null;
  recomputed  bytea;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if verify_chain.stream_key like 'attendance:%' then
    for r in
      select * from attendance_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.event_kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'worker:%' then
    for r in
      select * from worker_stream_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'contact:%' then
    for r in
      select * from contact_events e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind::text, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  elsif verify_chain.stream_key like 'accolade:%' then
    for r in
      select * from lot_accolades e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind::text, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  else
    for r in
      select * from lot_event e
       where e.stream_key = verify_chain.stream_key and e.tenant_id = v_tenant
       order by e.device_seq
    loop
      if r.prev_hash is distinct from expect_prev then return false; end if;
      recomputed := event_set_hash(r.prev_hash, r.stream_key, r.kind, r.payload,
                                   r.occurred_at, r.device_id, r.device_seq);
      if recomputed is distinct from r.hash then return false; end if;
      expect_prev := recomputed;
    end loop;
    return true;
  end if;
end $$;
revoke execute on function verify_chain(text) from public;
grant   execute on function verify_chain(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. _append_accolade — the internal ledger writer (owner-only; never caller-facing).
--    Inserts the immutable accolade row (the hash trigger chains it) and appends a
--    lot_event onto the LOT's provenance stream in the SAME txn. Idempotent on the
--    (already tenant-qualified) key supplied by the command RPCs.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function _append_accolade(
  p_lot_code          text,
  p_kind              text,
  p_title             text,
  p_score             numeric,
  p_awarded_by        text,
  p_award_year        int,
  p_evidence_url      text,
  p_source_session_id bigint,
  p_reverses_id       bigint,
  p_event_kind        text,
  p_key               text          -- tenant-qualified
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;

  -- idempotent append: a replay with the same tenant-qualified key returns the original.
  select id into v_id from lot_accolades
   where tenant_id = v_tenant and idempotency_key = p_key;
  if v_id is not null then return v_id; end if;

  insert into lot_accolades (tenant_id, lot_code, kind, title, score, awarded_by, award_year,
                             evidence_url, source_session_id, reverses_id, stream_key, payload,
                             occurred_at, device_id, device_seq, idempotency_key)
  values (v_tenant, p_lot_code, p_kind::accolade_kind, p_title, p_score, p_awarded_by, p_award_year,
          p_evidence_url, p_source_session_id, p_reverses_id, 'accolade:' || p_lot_code,
          jsonb_strip_nulls(jsonb_build_object(
            'kind', p_kind, 'title', p_title, 'score', p_score, 'awarded_by', p_awarded_by,
            'award_year', p_award_year, 'evidence_url', p_evidence_url,
            'source_session_id', p_source_session_id, 'reverses_id', p_reverses_id)),
          now(), 'server', nextval('lot_code_seq'), p_key)
  returning id into v_id;

  -- the lot's provenance chain: a reputation event is part of the lot's story.
  perform record_lot_event(
    p_lot_code, p_event_kind,
    jsonb_build_object('accolade_id', v_id, 'kind', p_kind, 'title', p_title,
                       'score', p_score, 'awarded_by', p_awarded_by, 'award_year', p_award_year,
                       'reverses_id', p_reverses_id),
    now(), 'server', nextval('lot_code_seq'), p_key || ':event');

  return v_id;
end $$;
revoke execute on function _append_accolade(text, text, text, numeric, text, int, text, bigint, bigint, text, text) from public;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. record_accolade — the write door. Binds a NEW accolade (cup-score/award/cert/
--    press-mention) to a lot. 'score-revision' is REFUSED here (revisions flow only
--    through revise_accolade, which carries the reverses_id binding). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function record_accolade(
  p_lot_code          text,
  p_kind              text,
  p_title             text,
  p_score             numeric,
  p_awarded_by        text,
  p_award_year        int,
  p_evidence_url      text,
  p_source_session_id bigint,
  p_idempotency_key   text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'score-revision' then
    raise exception 'a score-revision is posted via revise_accolade, not record_accolade'
      using errcode = 'check_violation';
  end if;
  if p_kind = 'cup-score' and (p_score is null or p_score < 0 or p_score > 100) then
    raise exception 'a cup-score accolade must carry a score in [0,100] (got %)', p_score
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from lots where code = p_lot_code and tenant_id = v_tenant) then
    raise exception 'unknown lot % for tenant', p_lot_code using errcode = 'foreign_key_violation';
  end if;
  v_key := v_tenant::text || ':' || p_idempotency_key;

  return _append_accolade(p_lot_code, p_kind, p_title, p_score, p_awarded_by, p_award_year,
                          p_evidence_url, p_source_session_id, null, 'accolade_recorded', v_key);
end $$;
revoke execute on function record_accolade(text, text, text, numeric, text, int, text, bigint, text) from public;
grant   execute on function record_accolade(text, text, text, numeric, text, int, text, bigint, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. revise_accolade — the ONLY correction path. Posts a 'score-revision' REVERSING row
--    (reverses_id -> the original) carrying the corrected score; the original is never
--    edited, just superseded (excluded from the net-live view). The original must exist
--    in the caller's tenant, be a cup-score/score-revision, and not already be reversed.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function revise_accolade(
  p_accolade_id     bigint,
  p_new_score       numeric,
  p_note            text,
  p_idempotency_key text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key    text;
  v_lot    text;
  v_kind   accolade_kind;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  if p_new_score is null or p_new_score < 0 or p_new_score > 100 then
    raise exception 'a score-revision must carry a score in [0,100] (got %)', p_new_score
      using errcode = 'check_violation';
  end if;

  v_key := v_tenant::text || ':' || p_idempotency_key;
  -- idempotent: a replay returns the already-posted revision row.
  declare v_existing bigint;
  begin
    select id into v_existing from lot_accolades
     where tenant_id = v_tenant and idempotency_key = v_key;
    if v_existing is not null then return v_existing; end if;
  end;

  select lot_code, kind into v_lot, v_kind from lot_accolades
   where id = p_accolade_id and tenant_id = v_tenant;
  if v_lot is null then
    raise exception 'unknown accolade % for tenant', p_accolade_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_kind not in ('cup-score', 'score-revision') then
    raise exception 'only a cup-score (or a prior revision) can be revised; % is a %',
      p_accolade_id, v_kind using errcode = 'check_violation';
  end if;
  if exists (select 1 from lot_accolades
              where reverses_id = p_accolade_id and tenant_id = v_tenant) then
    raise exception 'accolade % has already been revised; revise the latest revision instead',
      p_accolade_id using errcode = 'check_violation';
  end if;

  return _append_accolade(v_lot, 'score-revision', p_note, p_new_score, null, null,
                          null, null, p_accolade_id, 'accolade_revised', v_key);
end $$;
revoke execute on function revise_accolade(bigint, numeric, text, text) from public;
grant   execute on function revise_accolade(bigint, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Read views (security_invoker → inherit the caller's RLS on the base tables).
-- ════════════════════════════════════════════════════════════════════════════

-- v_lot_reputation — per lot: net LIVE accolades (excluding any row a later revision
-- reverses), best cup score, award/cert/press counts, reconciled to the QC truth
-- (green_lots.cupping_score / sca_grade). Drives the per-lot reputation card + the
-- /reputation wall of fame.
create view v_lot_reputation with (security_invoker = on) as
with reversed as (
  select distinct reverses_id as id from lot_accolades where reverses_id is not null
),
live as (
  select a.* from lot_accolades a
   left join reversed r on r.id = a.id
   where r.id is null
)
select
  l.tenant_id,
  l.lot_code,
  g.cupping_score                                                        as qc_cupping_score,
  g.sca_grade,
  max(l.score) filter (where l.kind in ('cup-score','score-revision'))   as best_cup_score,
  count(*)::int                                                          as accolade_count,
  count(*) filter (where l.kind = 'award')::int                          as award_count,
  array_remove(array_agg(l.title) filter (where l.kind = 'award'), null) as awards,
  count(*) filter (where l.kind = 'certification')::int                  as cert_count,
  array_remove(array_agg(l.title) filter (where l.kind = 'certification'), null) as certs,
  count(*) filter (where l.kind = 'press-mention')::int                  as press_count,
  max(l.occurred_at)                                                     as last_accolade_at
from live l
  left join green_lots g on g.lot_code = l.lot_code and g.tenant_id = l.tenant_id
group by l.tenant_id, l.lot_code, g.cupping_score, g.sca_grade;

-- v_lot_reputation_public — the NARROW public projection (title/score/awarded_by/
-- award_year ONLY; net live rows). This slice grants it to AUTHENTICATED ONLY.
-- TODO(P3-S13): grant select on v_lot_reputation_public to anon — the curated public
-- provenance projection (P3-S13 owns the single anon read surface).
create view v_lot_reputation_public with (security_invoker = on) as
with reversed as (
  select distinct reverses_id as id from lot_accolades where reverses_id is not null
),
live as (
  select a.* from lot_accolades a
   left join reversed r on r.id = a.id
   where r.id is null
)
select
  l.tenant_id,
  l.lot_code,
  l.title,
  l.score,
  l.awarded_by,
  l.award_year
from live l;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. RLS — tenant-scoped read (P4-S0 idiom). Writes flow through the SECDEF RPCs
--    (bypass RLS + self-clamp), so NO insert/update/delete policy — read-only at the
--    policy layer (RPC-only-write).
-- ════════════════════════════════════════════════════════════════════════════
alter table lot_accolades enable row level security;
create policy "tenant read" on public.lot_accolades for select to authenticated
  using (tenant_id = current_tenant_id());

-- ════════════════════════════════════════════════════════════════════════════
-- 9. GRANTS (AD-8) — per-object SELECT to authenticated (one statement each so the
--    name-anchored static guard matches). NO write grants; anon gets NOTHING. RPC
--    execute is revoked-from-public-then-granted at each definition above.
-- ════════════════════════════════════════════════════════════════════════════
grant select on lot_accolades            to authenticated;
grant select on v_lot_reputation         to authenticated;
grant select on v_lot_reputation_public  to authenticated;

commit;
