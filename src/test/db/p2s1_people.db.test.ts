// P2-S1 — Crew + worker system-of-record: SQL tests that replay the REAL migrations
// in PGlite and prove the slice's load-bearing data-layer invariants (the DESIGN's
// "Key invariants" + the AD-8 grant posture + the backfill-parity de-risk).
//
//   - CREW BACKFILL PARITY: after the migration, v_crew_roster reproduces the EXACT
//     original workers.crew grouping for every worker (the rename-aside is lossless).
//   - ATTENDANCE append-only: record_attendance appends + resyncs workers.attendance;
//     UPDATE and DELETE on attendance_event raise; a replay (same idempotency_key) is
//     exactly-once.
//   - POR-OBRA supersede + rate immutability: sign_por_obra_contract appends and
//     supersedes the prior open contract (never edits); the rate columns are immutable
//     (a direct UPDATE of rate_usd raises); v_active_por_obra resolves the effective
//     rate on a date by the effective_from/to window.
//   - CERTS validity: record_certification appends; v_worker_certs_valid includes a
//     non-expired cert and excludes an expired one.
//   - REHIRE carries identity + certs: rehire_worker opens a fresh membership, keeps
//     the worker's identity + still-valid certs, logs a WORKER_REHIRED event, and
//     refuses a non-rehire-eligible worker.
//   - AD-8 GRANTS: authenticated reads the new views; anon reads NOTHING (its SELECT
//     grant was never issued); the command RPCs execute for authenticated.
//
// Runs the authenticated/anon roles via the harness so it exercises the live posture.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

// now()-relative so memberships closed at this occurred_at always satisfy the
// crew_memberships CHECK (left_at >= joined_at) — the seed backfill opens each
// worker's first membership at joined_at = now(), so a fixed wall-clock literal
// went stale once real UTC passed it (it flaked daily after noon). +1h keeps the
// enroll/rehire occurred_at safely at-or-after the seed's now() at any wall time.
const DEV = `(now() + interval '1 hour')`;

// The migrations create EMPTY tables; seed.sql (which runs after them in prod) inserts
// workers and then calls _backfill_people(). The PGlite harness replays migrations
// only — so each test seeds the same workforce fixture and runs the backfill exactly
// as production does. This 4-crew slice mirrors src/lib/data/workers.ts (the SSOT the
// generated seed derives from).
const SEED_WORKERS = `
insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-01','Miguel Janson','Supervisor',42,'present',2009,'+507 6500-1209',0,'Field Ops'),
  ('w-02','Janette Janson','Agronomist',48,'present',2011,'+507 6500-3382',0,'Field Ops'),
  ('w-03','Eduardo Pérez','Picker',22,'present',2015,'+507 6612-7741',92,'Crew Norte'),
  ('w-04','Rosa Quintero','Picker',22,'present',2016,'+507 6633-1180',84,'Crew Norte'),
  ('w-05','Tomás Atencio','Picker',22,'present',2018,'+507 6644-9921',64,'Crew Tizingal'),
  ('w-06','Lucía Morales','Picker',22,'present',2019,'+507 6655-2210',88,'Crew Tizingal'),
  ('w-07','Carlos Beker','Picker',22,'rest-day',2014,'+507 6677-4456',0,'Crew Norte'),
  ('w-08','Ana Serrano','Picker',22,'present',2020,'+507 6688-0034',76,'Crew Tizingal'),
  ('w-09','Pedro Caballero','Picker',22,'present',2017,'+507 6699-7712',90,'Crew Norte'),
  ('w-10','Néstor Gómez','Mill Operator',30,'present',2013,'+507 6701-5589',0,'Crew Mill'),
  ('w-11','Yarisel Pitti','Mill Operator',30,'present',2018,'+507 6712-3301',0,'Crew Mill'),
  ('w-12','Raúl Santamaría','Driver',28,'present',2012,'+507 6723-8890',0,'Field Ops'),
  ('w-13','Iris Castillo','Picker',22,'present',2021,'+507 6734-1145',71,'Crew Tizingal'),
  ('w-14','Félix Rodríguez','Picker',22,'present',2016,'+507 6745-6622',79,'Crew Norte');`;

/** Seed the workforce and run the promote-in-place backfill, exactly as prod does. */
async function seedPeople(h: Harness): Promise<void> {
  await h.query(SEED_WORKERS);
  await h.query(`select _backfill_people();`);
}

describe("P2-S1 — crew backfill parity (the rename-aside is lossless)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("seeds one crew per DISTINCT original workers.crew string", async () => {
    const crews = await h.query<{ name: string }>(
      `select name from crews order by name;`,
    );
    const distinct = await h.query<{ crew: string }>(
      `select distinct crew from workers order by crew;`,
    );
    expect(crews.map((c) => c.name)).toEqual(distinct.map((d) => d.crew));
  });

  it("backfills exactly one ACTIVE membership per worker", async () => {
    const rows = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where left_at is null;`,
    );
    const workers = await h.query<{ n: number }>(
      `select count(*)::int as n from workers;`,
    );
    expect(rows[0].n).toBe(workers[0].n);
  });

  it("v_crew_roster reproduces the EXACT original workers.crew grouping for every worker", async () => {
    // The de-risk parity check: every worker's roster crew_name === their original
    // workers.crew, and the per-crew membership counts match the original grouping.
    const mismatched = await h.query<{ worker_id: string }>(
      `select r.worker_id
         from v_crew_roster r
         join workers w on w.id = r.worker_id
        where r.crew_name is distinct from w.crew;`,
    );
    expect(mismatched).toEqual([]);

    const rosterGroups = await h.query<{ crew_name: string; n: number }>(
      `select crew_name, count(*)::int as n from v_crew_roster group by crew_name order by crew_name;`,
    );
    const originalGroups = await h.query<{ crew: string; n: number }>(
      `select crew, count(*)::int as n from workers group by crew order by crew;`,
    );
    expect(rosterGroups.map((g) => [g.crew_name, g.n])).toEqual(
      originalGroups.map((g) => [g.crew, g.n]),
    );
  });

  it("retains workers.crew and workers.attendance as derived columns (Phase-1 reads survive)", async () => {
    // a Phase-1-style read of workers still returns crew + attendance for w-06.
    const r = await h.query<{ crew: string; attendance: string }>(
      `select crew, attendance from workers where id = 'w-06';`,
    );
    expect(r[0].crew).toBeTruthy();
    expect(r[0].attendance).toBeTruthy();
  });
});

describe("P2-S1 — attendance ledger (append-only + exactly-once)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("record_attendance appends an event and resyncs the derived workers.attendance", async () => {
    await h.query(
      `select record_attendance('w-06','rest-day',null,${DEV},'dev-A',1,'att-1');`,
    );
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from attendance_event where worker_id='w-06';`,
    );
    expect(ev[0].n).toBe(1);
    const w = await h.query<{ attendance: string }>(
      `select attendance from workers where id='w-06';`,
    );
    expect(w[0].attendance).toBe("rest-day");
  });

  it("is exactly-once on idempotency_key (a replay creates NO second event)", async () => {
    const first = await h.query<{ record_attendance: string }>(
      `select record_attendance('w-06','clock-in',null,${DEV},'dev-A',2,'att-dup') as record_attendance;`,
    );
    const second = await h.query<{ record_attendance: string }>(
      `select record_attendance('w-06','clock-in',null,${DEV},'dev-A',2,'att-dup') as record_attendance;`,
    );
    expect(first[0].record_attendance).toBe(second[0].record_attendance);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from attendance_event where idempotency_key='att-dup';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("REJECTS an UPDATE of an attendance event (append-only)", async () => {
    await expect(
      h.query(`update attendance_event set event_kind='absent' where idempotency_key='att-1';`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
  });

  it("REJECTS a DELETE of an attendance event (append-only)", async () => {
    await expect(
      h.query(`delete from attendance_event where idempotency_key='att-1';`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
  });

  it("rejects an unknown event_kind (CHECK)", async () => {
    await expect(
      h.query(`select record_attendance('w-06','teleport',null,${DEV},'dev-A',9,'att-bad');`),
    ).rejects.toThrow();
  });

  it("raises on an unknown worker (FK guard inside the RPC)", async () => {
    await expect(
      h.query(`select record_attendance('w-nobody','clock-in',null,${DEV},'dev-A',10,'att-x');`),
    ).rejects.toThrow(/unknown worker/i);
  });

  it("projects worker_attendance_today from the latest event TODAY", async () => {
    // worker_attendance_today filters on current_date, so record at now() (real today)
    // and a later now() event to prove "latest wins". w-08 keeps this case isolated.
    await h.query(
      `select record_attendance('w-08','clock-in',null,now() - interval '2 hours','dev-T',1,'att-t1');`,
    );
    await h.query(
      `select record_attendance('w-08','clock-out',null,now(),'dev-T',2,'att-t2');`,
    );
    const rows = await h.query<{ worker_id: string; event_kind: string }>(
      `select worker_id, event_kind from worker_attendance_today where worker_id='w-08';`,
    );
    // the latest event today is the clock-out.
    expect(rows[0].event_kind).toBe("clock-out");
  });
});

describe("P2-S1 — por-obra contracts (supersede + rate immutability + resolver)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("sign appends a contract and the resolver returns its rate within the window", async () => {
    await h.query(
      `select sign_por_obra_contract('w-06','picking','per-lata',3.50,'2026-06-01',null,'sig-1','po-1');`,
    );
    const r = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-06','picking','2026-06-15');`,
    );
    expect(Number(r[0].rate_usd)).toBeCloseTo(3.5, 2);
  });

  it("a NEW contract SUPERSEDES the prior open one (never edits it)", async () => {
    await h.query(
      `select sign_por_obra_contract('w-06','picking','per-lata',4.00,'2026-06-10',null,'sig-2','po-2');`,
    );
    // the first contract is now superseded (superseded_by set), still present (not deleted).
    const superseded = await h.query<{ superseded_by: number | null }>(
      `select superseded_by from por_obra_contracts where signature_ref='sig-1';`,
    );
    expect(superseded[0].superseded_by).not.toBeNull();
    // the resolver now returns the NEW rate on a date in the new window.
    const r = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-06','picking','2026-06-20');`,
    );
    expect(Number(r[0].rate_usd)).toBeCloseTo(4.0, 2);
  });

  it("the rate is IMMUTABLE once signed (a direct UPDATE of rate_usd raises)", async () => {
    await expect(
      h.query(`update por_obra_contracts set rate_usd = 99 where signature_ref='sig-1';`),
    ).rejects.toThrow(/immutable|append-only|supersede/i);
  });

  it("REJECTS a DELETE of a contract (append-only)", async () => {
    await expect(
      h.query(`delete from por_obra_contracts where signature_ref='sig-1';`),
    ).rejects.toThrow(/append-only|blocked/i);
  });

  it("enforces effective_to >= effective_from (CHECK)", async () => {
    await expect(
      h.query(
        `select sign_por_obra_contract('w-06','weeding','per-tarea',2.00,'2026-06-20','2026-06-01','sig-x','po-x');`,
      ),
    ).rejects.toThrow();
  });
});

describe("P2-S1 — por-obra resolver is window-authoritative (the supersede chain is audit metadata, not a resolution filter)", () => {
  // REGRESSION (review HIGH idx 6/30/60): the supersede UPDATE in
  // sign_por_obra_contract is window-blind — signing ANY contract stamps
  // superseded_by on every still-open contract for the worker+task. v_active_por_obra
  // previously filtered `superseded_by is null`, so the moment a second contract was
  // signed the first vanished from the resolver for ANY date — INCLUDING dates inside
  // its own effective window. A back-pay / audit / late-offline-sync lookup of a
  // historical piece-rate then priced the day at NOTHING (a money/compliance failure
  // for the piece-rate crew). The fix makes the date WINDOW the sole resolution
  // authority. Each case below RETURNS ZERO ROWS on the pre-fix resolver.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("a non-overlapping FUTURE contract stays resolvable after a current-season contract is signed", async () => {
    // pre-sign next season's rate, THEN sign this season's — non-overlapping windows.
    await h.query(
      `select sign_por_obra_contract('w-06','picking','per-lata',5.00,'2027-01-01','2027-12-31','fut-sig','fut-key');`,
    );
    await h.query(
      `select sign_por_obra_contract('w-06','picking','per-lata',3.50,'2026-06-01','2026-12-31','now-sig','now-key');`,
    );
    // the 2027 rate the worker pre-agreed to still resolves inside its own window.
    const r = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-06','picking','2027-06-15');`,
    );
    expect(r.length).toBe(1);
    expect(Number(r[0].rate_usd)).toBeCloseTo(5.0, 2);
    // and the 2026 rate resolves inside its window.
    const r2 = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-06','picking','2026-08-15');`,
    );
    expect(Number(r2[0].rate_usd)).toBeCloseTo(3.5, 2);
  });

  it("a CLOSED historical window stays resolvable after a later contract is signed", async () => {
    // A: closed Jan–Mar @3.00, then B: open from Jun @4.00 (the idx 60 scenario).
    await h.query(
      `select sign_por_obra_contract('w-08','picking','per-lata',3.00,'2026-01-01','2026-03-31','h-sig-a','h-key-a');`,
    );
    await h.query(
      `select sign_por_obra_contract('w-08','picking','per-lata',4.00,'2026-06-01',null,'h-sig-b','h-key-b');`,
    );
    // Feb is inside A's window — it must still price at 3.00, not nothing.
    const feb = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-08','picking','2026-02-15');`,
    );
    expect(feb.length).toBe(1);
    expect(Number(feb[0].rate_usd)).toBeCloseTo(3.0, 2);
    // Jul is inside B's window — it prices at 4.00.
    const jul = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-08','picking','2026-07-15');`,
    );
    expect(Number(jul[0].rate_usd)).toBeCloseTo(4.0, 2);
  });

  it("an OPEN-ENDED contract superseded by a NARROWER, BOUNDED window stays resolvable on its own dates (the idx 155 partial-window strand)", async () => {
    // The finding's exact scenario: an open-ended 'picking' rate from Jun-01 @3.00,
    // THEN a later, NARROWER 'picking' contract bounded to July only @5.00. The signing
    // RPC stamps superseded_by on the June row regardless of window, so a resolver that
    // filtered `superseded_by is null` strands June: the worker's June latas would price
    // at NOTHING. With the window as sole authority, June still resolves to 3.00.
    await h.query(
      `select sign_por_obra_contract('w-09','picking','per-lata',3.00,'2026-06-01',null,'pw-sig-a','pw-key-a');`,
    );
    await h.query(
      `select sign_por_obra_contract('w-09','picking','per-lata',5.00,'2026-07-01','2026-07-31','pw-sig-b','pw-key-b');`,
    );
    // the June row got superseded (audit lineage stamped) — but is NOT deleted.
    const superseded = await h.query<{ superseded_by: number | null }>(
      `select superseded_by from por_obra_contracts where signature_ref='pw-sig-a';`,
    );
    expect(superseded[0].superseded_by).not.toBeNull();
    // Jun-15 is inside the open-ended June window AND outside July's — it must STILL
    // price at 3.00, the rate the worker actually picked under. (0 rows on pre-fix.)
    const jun = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-09','picking','2026-06-15');`,
    );
    expect(jun.length).toBe(1);
    expect(Number(jun[0].rate_usd)).toBeCloseTo(3.0, 2);
    // Jul-15 is covered by the bounded July contract — it prices at 5.00.
    const jul = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-09','picking','2026-07-15');`,
    );
    expect(Number(jul[0].rate_usd)).toBeCloseTo(5.0, 2);
    // Aug-15: July's bounded window has ended; the open-ended June contract CONTINUES,
    // so it resolves back to 3.00 (the open contract is not killed by a finite gap).
    const aug = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-09','picking','2026-08-15');`,
    );
    expect(aug.length).toBe(1);
    expect(Number(aug[0].rate_usd)).toBeCloseTo(3.0, 2);
  });

  it("an OVERLAPPING renegotiation resolves later-effective inside the overlap, earlier-effective outside it", async () => {
    // A: open from Jun-01 @3.50, B: open from Jun-10 @4.00 (both open, overlapping).
    await h.query(
      `select sign_por_obra_contract('w-13','picking','per-lata',3.50,'2026-06-01',null,'o-sig-a','o-key-a');`,
    );
    await h.query(
      `select sign_por_obra_contract('w-13','picking','per-lata',4.00,'2026-06-10',null,'o-sig-b','o-key-b');`,
    );
    // Jun-05 is inside A's EXCLUSIVE pre-B window → the historically-agreed 3.50.
    const pre = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-13','picking','2026-06-05');`,
    );
    expect(pre.length).toBe(1);
    expect(Number(pre[0].rate_usd)).toBeCloseTo(3.5, 2);
    // Jun-20 is covered by both → the later-effective 4.00.
    const post = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-13','picking','2026-06-20');`,
    );
    expect(Number(post[0].rate_usd)).toBeCloseTo(4.0, 2);
  });
});

describe("P2-S1 — verify_chain is attendance/worker-stream aware (the chain-verified badge actually verifies)", () => {
  // REGRESSION (review HIGH idx 24/59): the Phase-1 verify_chain iterated ONLY
  // lot_event, but the attendance ledger lives in attendance_event ('attendance:<id>')
  // and the worker life-stream in worker_stream_event ('worker:<id>'). So
  // verify_chain('attendance:<id>') found zero lot_event rows and returned a vacuous
  // `true` — the "Chain verified" badge was a permanent false-positive that could never
  // go amber even on a corrupted attendance ledger. The redefinition branches on the
  // stream_key prefix and recomputes over the correct table.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
    await h.query(
      `select record_attendance('w-06','clock-in',null,${DEV},'dev-A',1,'vc-att-1');`,
    );
    await h.query(
      `select record_attendance('w-06','clock-out',null,(now() + interval '6 hours'),'dev-A',2,'vc-att-2');`,
    );
    // a worker-stream event too (enroll appends a WORKER_ENROLLED row).
    await h.query(
      `select enroll_crew_member('w-06','crew-norte',${DEV},'server',next_server_seq(),'vc-enr-1');`,
    );
  });
  afterAll(async () => h.close());

  it("verify_chain('attendance:<id>') is TRUE on a clean attendance ledger (and actually reads attendance_event)", async () => {
    // sanity: the rows live in attendance_event, NOT lot_event.
    const att = await h.query<{ n: number }>(
      `select count(*)::int as n from attendance_event where stream_key='attendance:w-06';`,
    );
    expect(att[0].n).toBe(2);
    const lot = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='attendance:w-06';`,
    );
    expect(lot[0].n).toBe(0);
    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('attendance:w-06') as ok;`),
    );
    expect(r[0].ok).toBe(true);
  });

  it("verify_chain('attendance:<id>') FLIPS to FALSE once a stored attendance hash is tampered", async () => {
    // mimic an attacker with raw DB access: disable the append-only block trigger,
    // re-forge one row's payload (the hash no longer matches), re-enable. The pre-fix
    // verify_chain (lot_event only) returns true regardless — this is the red→green.
    await h.query(
      `alter table attendance_event disable trigger attendance_event_block_mutation;`,
    );
    await h.query(
      `update attendance_event set payload = '{"tampered": true}'::jsonb
         where stream_key='attendance:w-06' and device_seq = 2;`,
    );
    await h.query(
      `alter table attendance_event enable trigger attendance_event_block_mutation;`,
    );
    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('attendance:w-06') as ok;`),
    );
    expect(r[0].ok).toBe(false);
  });

  it("verify_chain('worker:<id>') is TRUE on a clean worker stream and FALSE after tamper", async () => {
    const clean = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('worker:w-06') as ok;`),
    );
    expect(clean[0].ok).toBe(true);
    await h.query(
      `alter table worker_stream_event disable trigger worker_stream_event_block_mutation;`,
    );
    await h.query(
      `update worker_stream_event set payload = '{"tampered": true}'::jsonb
         where stream_key='worker:w-06';`,
    );
    await h.query(
      `alter table worker_stream_event enable trigger worker_stream_event_block_mutation;`,
    );
    const tampered = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('worker:w-06') as ok;`),
    );
    expect(tampered[0].ok).toBe(false);
  });
});

describe("P2-S1 — exactly-once is namespaced per command kind (a shared key cannot return a foreign event)", () => {
  // REGRESSION (review HIGH idx 40): enroll / rehire / sign / certify all write the
  // single worker_stream_event ledger and each takes a caller-supplied idempotency_key.
  // The old GLOBAL unique on the key let a key reused across command types
  // short-circuit on a FOREIGN command's event (a rehire reusing an enroll key
  // returned the enroll's event and reported success while opening no membership and
  // skipping the eligibility gate; a sign reusing an enroll key returned NULL and
  // dropped the contract). The (kind, idempotency_key) namespace makes each replay
  // guard match only its OWN command kind.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("rehire reusing an enroll's key still OPENS its own membership (does not return the enroll event)", async () => {
    await h.query(
      `select enroll_crew_member('w-06','crew-norte',${DEV},'server',next_server_seq(),'shared-k1');`,
    );
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    // rehire with the SAME key — must perform its OWN rehire, not short-circuit.
    await h.query(
      `select rehire_worker('w-06','crew-tizingal','2026-2027',${DEV},'server',next_server_seq(),'shared-k1');`,
    );
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    expect(after[0].n).toBe(before[0].n + 1);
    // a WORKER_REHIRED event exists under that key+kind (the rehire really happened).
    const reh = await h.query<{ n: number }>(
      `select count(*)::int as n from worker_stream_event
         where idempotency_key='shared-k1' and kind='WORKER_REHIRED';`,
    );
    expect(reh[0].n).toBe(1);
  });

  it("rehire reusing an enroll's key still ENFORCES the eligibility gate (no foreign-event bypass)", async () => {
    await h.query(`update worker_identity set rehire_eligible=false where worker_id='w-07';`);
    await h.query(
      `select enroll_crew_member('w-07','crew-norte',${DEV},'server',next_server_seq(),'shared-k2');`,
    );
    // a barred worker rehire under the same key must STILL raise (gate not skipped).
    await expect(
      h.query(
        `select rehire_worker('w-07','crew-tizingal','2026-2027',${DEV},'server',next_server_seq(),'shared-k2');`,
      ),
    ).rejects.toThrow(/not rehire-eligible/i);
  });

  it("sign_por_obra reusing an enroll's key still WRITES its own contract (does not return NULL)", async () => {
    await h.query(
      `select enroll_crew_member('w-08','crew-norte',${DEV},'server',next_server_seq(),'shared-k3');`,
    );
    const id = await h.query<{ sign_por_obra_contract: number | null }>(
      `select sign_por_obra_contract('w-08','picking','per-lata',3.50,'2026-06-01',null,'sig-shared','shared-k3') as sign_por_obra_contract;`,
    );
    expect(id[0].sign_por_obra_contract).not.toBeNull();
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from por_obra_contracts where worker_id='w-08' and signature_ref='sig-shared';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("a TRUE replay (same key AND same kind) is still exactly-once", async () => {
    const a = await h.query<{ enroll_crew_member: string }>(
      `select enroll_crew_member('w-09','crew-tizingal',${DEV},'server',next_server_seq(),'replay-k') as enroll_crew_member;`,
    );
    const b = await h.query<{ enroll_crew_member: string }>(
      `select enroll_crew_member('w-09','crew-tizingal',${DEV},'server',next_server_seq(),'replay-k') as enroll_crew_member;`,
    );
    expect(a[0].enroll_crew_member).toBe(b[0].enroll_crew_member);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from worker_stream_event
         where idempotency_key='replay-k' and kind='WORKER_ENROLLED';`,
    );
    expect(n[0].n).toBe(1);
  });
});

describe("P2-S1 — same-crew re-enroll appends NO spurious WORKER_ENROLLED event", () => {
  // REGRESSION (review MED idx 62): the membership UPDATE/INSERT are guarded, but the
  // WORKER_ENROLLED event insert previously ran UNCONDITIONALLY. A same-crew re-enroll
  // with a FRESH key (a deliberate, distinct action, not a replay) is a true no-op for
  // the membership but appended a permanent, hash-chained event recording an
  // enrollment that never happened. The fix only appends the event when the membership
  // actually changed.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
    // w-06 is in crew-tizingal (backfill). Move them to crew-norte (a real change).
    await h.query(
      `select enroll_crew_member('w-06','crew-norte',${DEV},'server',next_server_seq(),'sce-move');`,
    );
  });
  afterAll(async () => h.close());

  it("re-enrolling into the SAME active crew with a fresh key adds no new event and no new membership", async () => {
    const evBefore = await h.query<{ n: number }>(
      `select count(*)::int as n from worker_stream_event
         where stream_key='worker:w-06' and kind='WORKER_ENROLLED';`,
    );
    const memBefore = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    // already active in crew-norte; a fresh-key re-enroll is a true no-op.
    await h.query(
      `select enroll_crew_member('w-06','crew-norte',${DEV},'server',next_server_seq(),'sce-noop');`,
    );
    const evAfter = await h.query<{ n: number }>(
      `select count(*)::int as n from worker_stream_event
         where stream_key='worker:w-06' and kind='WORKER_ENROLLED';`,
    );
    const memAfter = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    expect(evAfter[0].n).toBe(evBefore[0].n); // no spurious append
    expect(memAfter[0].n).toBe(memBefore[0].n); // no spurious membership
    // exactly one ACTIVE membership remains, still crew-norte.
    const active = await h.query<{ crew_id: string }>(
      `select crew_id from crew_memberships where worker_id='w-06' and left_at is null;`,
    );
    expect(active.length).toBe(1);
    expect(active[0].crew_id).toBe("crew-norte");
  });
});

describe("P2-S1 — certification ledger + validity view", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("record_certification appends a cert", async () => {
    await h.query(
      `select record_certification('w-06','pesticide-handling','2026-01-01','2027-01-01','MIDA','doc-1','cert-1');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from worker_certifications where worker_id='w-06';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("v_worker_certs_valid INCLUDES a non-expired cert", async () => {
    const rows = await h.query<{ cert_kind: string }>(
      `select cert_kind from v_worker_certs_valid where worker_id='w-06';`,
    );
    expect(rows.map((r) => r.cert_kind)).toContain("pesticide-handling");
  });

  it("v_worker_certs_valid EXCLUDES an expired cert", async () => {
    await h.query(
      `select record_certification('w-06','chainsaw','2020-01-01','2021-01-01','MIDA','doc-2','cert-2');`,
    );
    const rows = await h.query<{ cert_kind: string }>(
      `select cert_kind from v_worker_certs_valid where worker_id='w-06';`,
    );
    expect(rows.map((r) => r.cert_kind)).not.toContain("chainsaw");
  });

  it("REJECTS an UPDATE of a cert (append-only)", async () => {
    await expect(
      h.query(`update worker_certifications set cert_kind='x' where doc_ref='doc-1';`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
  });
});

describe("P2-S1 — rehire carries identity + valid certs forward", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
    // give w-06 an identity flavour + a valid cert; w-07 is made non-rehire-eligible.
    await h.query(
      `update worker_identity set comarca_origin='Ngäbe-Buglé', languages=array['es','ngäbere'] where worker_id='w-06';`,
    );
    await h.query(
      `select record_certification('w-06','pesticide-handling','2026-01-01','2027-01-01','MIDA','doc-1','cert-1');`,
    );
    await h.query(`update worker_identity set rehire_eligible=false where worker_id='w-07';`);
  });
  afterAll(async () => h.close());

  it("opens a FRESH active membership in the new crew and logs WORKER_REHIRED", async () => {
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    await h.query(
      `select rehire_worker('w-06','crew-norte','2026-2027',${DEV},'dev-A',1,'rehire-1');`,
    );
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    expect(after[0].n).toBe(before[0].n + 1);
    const active = await h.query<{ crew_id: string }>(
      `select crew_id from crew_memberships where worker_id='w-06' and left_at is null;`,
    );
    expect(active[0].crew_id).toBe("crew-norte");
    const ev = await h.query<{ kind: string }>(
      `select kind from worker_stream_event where idempotency_key='rehire-1';`,
    );
    expect(ev[0].kind).toBe("WORKER_REHIRED");
  });

  it("carries identity forward unchanged (never re-keyed)", async () => {
    const id = await h.query<{ comarca_origin: string; languages: string[] }>(
      `select comarca_origin, languages from worker_identity where worker_id='w-06';`,
    );
    expect(id[0].comarca_origin).toBe("Ngäbe-Buglé");
    expect(id[0].languages).toContain("ngäbere");
  });

  it("carries the still-valid cert forward (it stays in v_worker_certs_valid)", async () => {
    const certs = await h.query<{ cert_kind: string }>(
      `select cert_kind from v_worker_certs_valid where worker_id='w-06';`,
    );
    expect(certs.map((c) => c.cert_kind)).toContain("pesticide-handling");
    // the rehire event records the valid-cert count it carried.
    const payload = await h.query<{ valid_certs: string }>(
      `select payload->>'valid_certs' as valid_certs from worker_stream_event where idempotency_key='rehire-1';`,
    );
    expect(Number(payload[0].valid_certs)).toBeGreaterThanOrEqual(1);
  });

  it("REFUSES to rehire a non-rehire-eligible worker (fail-closed)", async () => {
    await expect(
      h.query(`select rehire_worker('w-07','crew-norte','2026-2027',${DEV},'dev-A',2,'rehire-2');`),
    ).rejects.toThrow(/not rehire-eligible/i);
  });

  it("is exactly-once on idempotency_key (a replay opens NO second membership)", async () => {
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    await h.query(
      `select rehire_worker('w-06','crew-norte','2026-2027',${DEV},'dev-A',1,'rehire-1');`,
    );
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where worker_id='w-06';`,
    );
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("P2-S1 — enroll_crew_member moves a worker + resyncs the derived crew", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("closes the old membership, opens the new one, resyncs workers.crew", async () => {
    await h.query(
      `select enroll_crew_member('w-06','crew-norte',${DEV},'dev-A',1,'enroll-1');`,
    );
    const active = await h.query<{ crew_id: string }>(
      `select crew_id from crew_memberships where worker_id='w-06' and left_at is null;`,
    );
    expect(active.length).toBe(1);
    expect(active[0].crew_id).toBe("crew-norte");
    // the derived workers.crew resynced to the new crew's name.
    const w = await h.query<{ crew: string }>(`select crew from workers where id='w-06';`);
    const crewName = await h.query<{ name: string }>(
      `select name from crews where id='crew-norte';`,
    );
    expect(w[0].crew).toBe(crewName[0].name);
  });
});

describe("P2-S1 — hash-chain verifies on the worker ledgers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
    await h.query(
      `select record_attendance('w-06','clock-in',null,${DEV},'dev-A',1,'att-c1');`,
    );
    await h.query(
      `select record_attendance('w-06','clock-out',null,(now() + interval '6 hours'),'dev-A',2,'att-c2');`,
    );
    // two events on the PII-scoped worker:w-06 stream (a cert then a rehire), so its
    // hash chain has a genuine prev->hash link to verify (idx 154).
    await h.query(
      `select record_certification('w-06','pesticide-handling','2026-01-01','2027-01-01','MIDA','wsc-doc','wsc-cert');`,
    );
    await h.query(
      `select rehire_worker('w-06','crew-norte','2026-2027',${DEV},'server',next_server_seq(),'wsc-rehire');`,
    );
  });
  afterAll(async () => h.close());

  // The corrected fix for idx 154: a naive prev_hash===prior-hash LINKAGE assertion is
  // a false sense of security — a "stop folding prev_hash into the digest" trigger
  // regression STILL sets the prev_hash column from the head; it only omits prev_hash
  // from the digest input, so the linkage check passes on the broken trigger. The
  // assertions below RECOMPUTE each row's hash from
  //   digest(coalesce(prev_hash,'') || lot_event_canonical_bytes(...), 'sha256')
  // and compare to the stored hash — which DOES go red on that mutant.

  it("each attendance event chains prev_hash -> hash AND every stored hash recomputes", async () => {
    const rows = await h.query<{ prev_hash: string | null; hash: string }>(
      `select encode(prev_hash,'hex') as prev_hash, encode(hash,'hex') as hash
         from attendance_event where worker_id='w-06' order by device_seq;`,
    );
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[0].hash).toBeTruthy();
    // the second event's prev_hash is the first event's hash (chained).
    expect(rows[1].prev_hash).toBe(rows[0].hash);
    // and every stored hash equals the recompute over its own canonical bytes — this
    // catches a trigger that stops folding prev_hash into the digest (linkage misses it).
    const ok = await h.query<{ ok: boolean }>(
      `select bool_and(recomputed = stored) as ok from (
         select encode(extensions.digest(
                  coalesce(prev_hash, ''::bytea)
                    || lot_event_canonical_bytes(stream_key, event_kind, payload,
                                                 occurred_at, device_id, device_seq),
                  'sha256'),'hex') as recomputed,
                encode(hash,'hex') as stored
           from attendance_event where stream_key='attendance:w-06' order by device_seq
       ) c;`,
    );
    expect(ok[0].ok).toBe(true);
  });

  it("the PII worker_stream_event chain is null-prev first AND every stored hash recomputes (idx 154)", async () => {
    // the cert + rehire both wrote the worker:w-06 stream — a real two-row PII ledger.
    const rows = await h.query<{ prev_hash: string | null; hash: string }>(
      `select encode(prev_hash,'hex') as prev_hash, encode(hash,'hex') as hash
         from worker_stream_event where stream_key='worker:w-06' order by device_seq;`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[0].hash).toBeTruthy();
    // RECOMPUTE: every stored hash == digest(coalesce(prev_hash,'') || canonical_bytes).
    // This pins the worker_stream_event_set_hash trigger — a regression that stopped
    // folding prev_hash into the digest (the mutant the naive linkage test misses)
    // makes recomputed != stored here, so the chain is no longer unpinned.
    const ok = await h.query<{ ok: boolean }>(
      `select bool_and(recomputed = stored) as ok from (
         select encode(extensions.digest(
                  coalesce(prev_hash, ''::bytea)
                    || lot_event_canonical_bytes(stream_key, kind, payload,
                                                 occurred_at, device_id, device_seq),
                  'sha256'),'hex') as recomputed,
                encode(hash,'hex') as stored
           from worker_stream_event where stream_key='worker:w-06' order by device_seq
       ) c;`,
    );
    expect(ok[0].ok).toBe(true);
  });
});

describe("P2-S1 — server device_seq is unique per write (the C1 collision guard)", () => {
  // REGRESSION (reviewer C1): the online server actions run on the single synthetic
  // device 'server'. attendance_event/worker_stream_event each carry
  // `unique (device_id, device_seq)`, so a CONSTANT device_seq (e.g. 0) collides on
  // the SECOND write system-wide. next_server_seq() hands out a monotonic seq so
  // ('server', seq) is unique within both tables forever. This proves the fix's
  // contract: two attendance writes on 'server' with next_server_seq() both land.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("next_server_seq() is strictly increasing", async () => {
    const a = await h.query<{ s: string }>(`select next_server_seq() as s;`);
    const b = await h.query<{ s: string }>(`select next_server_seq() as s;`);
    expect(Number(b[0].s)).toBeGreaterThan(Number(a[0].s));
  });

  it("two attendance writes on device 'server' with next_server_seq() BOTH succeed", async () => {
    // exactly the app's online path: same device_id 'server', a fresh seq each call.
    await h.query(
      `select record_attendance('w-03','clock-in',null,now(),'server',next_server_seq(),'srv-a1');`,
    );
    await h.query(
      `select record_attendance('w-04','clock-in',null,now(),'server',next_server_seq(),'srv-a2');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from attendance_event where device_id='server';`,
    );
    expect(n[0].n).toBe(2); // a constant device_seq=0 would have thrown on the 2nd.
  });

  it("a CONSTANT server device_seq DOES collide (proves the constraint that C1 hit)", async () => {
    await h.query(
      `select record_attendance('w-05','clock-in',null,now(),'srv2',0,'srv-c1');`,
    );
    // a second write reusing the SAME (device_id, device_seq) violates the unique key.
    await expect(
      h.query(
        `select record_attendance('w-08','clock-in',null,now(),'srv2',0,'srv-c2');`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("P2-S1 — AD-8 grant posture (authenticated yes / anon no)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedPeople(h);
  });
  afterAll(async () => h.close());

  it("authenticated CAN read v_crew_roster", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ worker_id: string }>(`select worker_id from v_crew_roster limit 1;`),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("anon CANNOT read v_crew_roster (no SELECT grant was ever issued)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from v_crew_roster limit 1;`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT read the attendance ledger", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from attendance_event limit 1;`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated CAN execute the command RPCs", async () => {
    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ record_attendance: string }>(
        `select record_attendance('w-06','clock-in',null,${DEV},'dev-Z',1,'att-auth') as record_attendance;`,
      ),
    );
    expect(r[0].record_attendance).toBeTruthy();
  });
});

describe("P2-S1 — seed.sql replays end-to-end and lands the dogfood data", () => {
  // The WHOLE seed must load cleanly on top of every migration (a broken people seed
  // — backfill call, RPC, FK — fails loudly here instead of shipping a dead /crew demo).
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
  });
  afterAll(async () => h.close());

  it("the backfill landed a crew + active membership + identity for all 14 workers", async () => {
    const crews = await h.query<{ n: number }>(`select count(*)::int as n from crews;`);
    expect(crews[0].n).toBe(4); // Crew Norte, Crew Tizingal, Crew Mill, Field Ops
    const active = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_memberships where left_at is null;`,
    );
    expect(active[0].n).toBe(14);
    const ids = await h.query<{ n: number }>(`select count(*)::int as n from worker_identity;`);
    expect(ids[0].n).toBe(14);
  });

  it("v_crew_roster carries the Ngäbe-Buglé dignity data for the returning picker", async () => {
    const r = await h.query<{ comarca_origin: string; languages: string[] }>(
      `select comarca_origin, languages from v_crew_roster where worker_id='w-06';`,
    );
    expect(r[0].comarca_origin).toBe("Ngäbe-Buglé");
    expect(r[0].languages).toContain("ngäbere");
  });

  it("the seeded pesticide cert is valid and the por-obra rate resolves", async () => {
    const certs = await h.query<{ cert_kind: string }>(
      `select cert_kind from v_worker_certs_valid where worker_id='w-06';`,
    );
    expect(certs.map((c) => c.cert_kind)).toContain("pesticide-handling");
    const rate = await h.query<{ rate_usd: string }>(
      `select rate_usd from v_active_por_obra('w-06','picking','2026-06-15');`,
    );
    expect(Number(rate[0].rate_usd)).toBeCloseTo(3.5, 2);
  });
});
