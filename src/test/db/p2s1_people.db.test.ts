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

const DEV = `'2026-06-22T12:00:00Z'`;

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
      `select record_attendance('w-06','clock-out',null,'2026-06-22T18:00:00Z','dev-A',2,'att-c2');`,
    );
  });
  afterAll(async () => h.close());

  it("each attendance event chains prev_hash -> hash (the first is null-prev)", async () => {
    const rows = await h.query<{ prev_hash: string | null; hash: string }>(
      `select encode(prev_hash,'hex') as prev_hash, encode(hash,'hex') as hash
         from attendance_event where worker_id='w-06' order by device_seq;`,
    );
    expect(rows[0].prev_hash).toBeNull();
    expect(rows[0].hash).toBeTruthy();
    // the second event's prev_hash is the first event's hash (chained).
    expect(rows[1].prev_hash).toBe(rows[0].hash);
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
