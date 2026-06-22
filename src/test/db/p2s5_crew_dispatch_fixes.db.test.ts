// P2-S5 — DEPENDENT-WAVE review regression tests (owner D05).
//
// These replay the REAL migrations in PGlite (same harness as
// p2s5_crew_dispatch.db.test.ts) and pin the data-layer invariants the phase-2
// review found unenforced in 20260622104000_crew_dispatch.sql. Each test is
// written to FAIL on the pre-fix migration and pass after the fix:
//
//   D05-1 (HIGH) single-active-plan invariant — a second active (non-superseded)
//         dispatch_run for the same crew+date must be structurally impossible
//         (partial-unique index), and a concurrent re-generate must supersede ALL
//         prior active runs, not just the most-recent one.
//   D05-2 (HIGH) mark_dispatch_sent must REJECT a non-active (superseded /
//         acknowledged) run BEFORE it enqueues a dispatch_outbound delivery — a
//         re-planned-away card may never be queued, and no false success returns.
//   D05-3 (HIGH) per-crew routing — when a crew has a crew_plot map, generate_dispatch
//         scopes the card to that crew's plots (two crews get DISTINCT plot lists);
//         a crew with no map falls back to all ready plots (the curate-later default).
//   D05-4 (MED)  dispatch_run_guard must freeze sent_at and forbid overwriting an
//         existing sent_channel on a same-status 'sent' run (send-audit immutability).
//
// (The note-column dead-schema findings D05-8/D05-9 and the dispatch_outbound
//  device-seq backstop D05-10 are deferred to Phase B — see the owner report.)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDb, type Harness } from "./pgliteHarness";

const DEV = `'2026-06-22T05:30:00Z'`;
const TODAY = `'2026-06-22'`;
const CREW_NORTE = `'crew-norte'`;
const CREW_TIZINGAL = `'crew-tizingal'`;

const SEED_WORKERS = `
insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-01','Miguel Janson','Supervisor',42,'present',2009,'+507 6500-1209',0,'Field Ops'),
  ('w-03','Eduardo Pérez','Picker',22,'present',2015,'+507 6612-7741',92,'Crew Norte'),
  ('w-04','Rosa Quintero','Picker',22,'present',2016,'+507 6633-1180',84,'Crew Norte'),
  ('w-05','Tomás Atencio','Picker',22,'present',2018,'+507 6644-9921',64,'Crew Tizingal');`;

// Three plots: two Norte (one ready, one not) and one Tizingal (ready) — so a crew→plot
// map can route Crew Norte and Crew Tizingal to DISTINCT plots.
const SEED_PLOTS = `
insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg) values
  ('p-norte-1', 1, 'Norte Bajo', 'Norte', 'Catuaí', 1.2, 1400, 3200, 40, 2012, 'healthy', '2026-06-01', 5000, 0),
  ('p-norte-2', 2, 'Norte Alto', 'Norte', 'Geisha', 0.8, 1650, 1800, 55, 2015, 'healthy', '2026-06-01', 2400, 0),
  ('p-tiz-1',   3, 'Tizingal Bajo', 'Tizingal', 'Catuaí', 1.0, 1350, 2600, 38, 2013, 'healthy', '2026-06-01', 4200, 0);`;

async function seedWorld(h: Harness): Promise<void> {
  await h.query(SEED_WORKERS);
  await h.query(SEED_PLOTS);
  await h.query(`select _backfill_people();`);
  // p-norte-1 and p-tiz-1 clearly ready; p-norte-2 not.
  await h.query(
    `select record_maturation_signal('p-norte-1','2026-02-01',2200,0.72,${DEV},'srv',1,'mat-1');`,
  );
  await h.query(
    `select record_maturation_signal('p-norte-2','2026-03-15',600,0.40,${DEV},'srv',2,'mat-2');`,
  );
  await h.query(
    `select record_maturation_signal('p-tiz-1','2026-02-01',2200,0.72,${DEV},'srv',3,'mat-3');`,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// D05-1 (HIGH) — single-active-plan invariant has a DATA-LAYER backstop.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S5 fix — one active dispatch_run per (crew, date) is structurally enforced", () => {
  let h: Harness;
  let activeId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',10,'disp-1') as generate_dispatch;`,
    );
    activeId = r[0].generate_dispatch;
  });
  afterAll(async () => h.close());

  it("REJECTS a second active (non-superseded) run for the same crew+date (the race end-state)", async () => {
    // This is exactly the two-interleaved-generate end-state under READ COMMITTED:
    // two drafts for one crew+date both un-superseded. The partial-unique index must
    // make the second active row impossible. FAILS on pre-fix schema (no unique index).
    await expect(
      h.query(
        `insert into dispatch_run (crew_id, dispatch_date, season, readiness_threshold,
                                   status, occurred_at, device_id, device_seq, idempotency_key)
         values ('crew-norte',${TODAY},'2026',0.5,'draft',${DEV},'srv',9999,'disp-race');`,
      ),
    ).rejects.toThrow(/unique|duplicate|dispatch_run_one_active/i);
  });

  it("a SUPERSEDED run does not occupy the active slot (a new active run is allowed once the prior is superseded)", async () => {
    // re-generating supersedes the prior run and inserts a new active one — proving the
    // partial-unique index is scoped to status <> 'superseded' (does not block re-plans).
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',11,'disp-2');`,
    );
    const active = await h.query<{ idempotency_key: string }>(
      `select idempotency_key from dispatch_run
        where crew_id='crew-norte' and dispatch_date=${TODAY} and status <> 'superseded';`,
    );
    expect(active.map((r) => r.idempotency_key)).toEqual(["disp-2"]);
    const prior = await h.query<{ status: string }>(
      `select status from dispatch_run where idempotency_key='disp-1';`,
    );
    expect(prior[0].status).toBe("superseded");
    expect(activeId).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D05-2 (HIGH) — mark_dispatch_sent never enqueues a delivery for a non-active run.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S5 fix — mark_dispatch_sent rejects a superseded run before enqueueing", () => {
  let h: Harness;
  let supersededId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',20,'disp-a') as generate_dispatch;`,
    );
    supersededId = r[0].generate_dispatch;
    // re-plan around rain → disp-a is superseded by disp-b.
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',21,'disp-b');`,
    );
  });
  afterAll(async () => h.close());

  it("the prior run is now superseded (precondition)", async () => {
    const rows = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${supersededId};`,
    );
    expect(rows[0].status).toBe("superseded");
  });

  it("REJECTS mark_dispatch_sent on the superseded run (no false success)", async () => {
    await expect(
      h.query(
        `select mark_dispatch_sent(${supersededId},'web-share',${DEV},'srv',22,'sent-stale');`,
      ),
    ).rejects.toThrow(/superseded|lifecycle|append-only|only an active|cannot/i);
  });

  it("enqueues ZERO dispatch_outbound rows for the superseded run", async () => {
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_outbound where dispatch_run_id=${supersededId};`,
    );
    expect(n[0].n).toBe(0);
  });

  it("still allows the legitimate draft→sent on the ACTIVE run", async () => {
    const active = await h.query<{ id: number }>(
      `select id from dispatch_run where idempotency_key='disp-b';`,
    );
    const activeId = active[0].id;
    await h.query(
      `select mark_dispatch_sent(${activeId},'web-share',${DEV},'srv',23,'sent-ok');`,
    );
    const rows = await h.query<{ status: string; sent_channel: string }>(
      `select status, sent_channel from dispatch_run where id=${activeId};`,
    );
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_channel).toBe("web-share");
    const out = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_outbound where dispatch_run_id=${activeId};`,
    );
    expect(out[0].n).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D05-3 (HIGH) — per-crew routing via a crew_plot map.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S5 fix — generate_dispatch scopes a card to the crew's plots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    // Norte owns the two Norte plots; Tizingal owns its one plot.
    await h.query(`select assign_crew_plot(${CREW_NORTE},'p-norte-1','2026',${DEV},'srv',101,'cp-1');`);
    await h.query(`select assign_crew_plot(${CREW_NORTE},'p-norte-2','2026',${DEV},'srv',102,'cp-2');`);
    await h.query(`select assign_crew_plot(${CREW_TIZINGAL},'p-tiz-1','2026',${DEV},'srv',103,'cp-3');`);
  });
  afterAll(async () => h.close());

  async function plotsFor(crew: string, key: string, seq: number): Promise<string[]> {
    await h.query(
      `select generate_dispatch('${crew}',${TODAY},'2026',0.5,${DEV},'srv',${seq},'${key}');`,
    );
    const rows = await h.query<{ plot_id: string }>(
      `select a.plot_id from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='${key}' order by a.plot_id;`,
    );
    return rows.map((r) => r.plot_id);
  }

  it("Crew Norte and Crew Tizingal get DISTINCT ready-plot lists (not the same global card)", async () => {
    const norte = await plotsFor("crew-norte", "disp-norte", 201);
    const tiz = await plotsFor("crew-tizingal", "disp-tiz", 202);
    // p-norte-1 and p-tiz-1 are both ready; routing must keep them on their own crew.
    expect(norte).toEqual(["p-norte-1"]);
    expect(tiz).toEqual(["p-tiz-1"]);
    expect(norte).not.toEqual(tiz);
  });

  it("assign_crew_plot is append-only EVIDENCE — a direct UPDATE/DELETE raises", async () => {
    await expect(
      h.query(`update crew_plot set active = false where idempotency_key='cp-1';`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
    await expect(
      h.query(`delete from crew_plot where idempotency_key='cp-1';`),
    ).rejects.toThrow(/append-only|blocked/i);
  });

  it("is exactly-once on idempotency_key (a replayed assignment is one row)", async () => {
    await h.query(`select assign_crew_plot(${CREW_NORTE},'p-norte-1','2026',${DEV},'srv',101,'cp-1');`);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from crew_plot where idempotency_key='cp-1';`,
    );
    expect(n[0].n).toBe(1);
  });
});

describe("P2-S5 fix — a crew with NO crew_plot map falls back to all ready plots", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    // NO crew_plot rows seeded — the curate-later default.
  });
  afterAll(async () => h.close());

  it("an unmapped crew still dispatches over all ready plots (backward-compatible)", async () => {
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',301,'disp-fb');`,
    );
    const rows = await h.query<{ plot_id: string }>(
      `select a.plot_id from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='disp-fb' order by a.plot_id;`,
    );
    // both ready plots (p-norte-1, p-tiz-1) come through since the crew has no scoping map.
    expect(rows.map((r) => r.plot_id)).toEqual(["p-norte-1", "p-tiz-1"]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D05-4 (MED) — send-audit immutability on a same-status 'sent' run.
// ════════════════════════════════════════════════════════════════════════════
describe("P2-S5 fix — a sent run's send-audit columns are frozen", () => {
  let h: Harness;
  let runId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',40,'disp-snt') as generate_dispatch;`,
    );
    runId = r[0].generate_dispatch;
    await h.query(
      `select mark_dispatch_sent(${runId},'web-share',${DEV},'srv',41,'sent-1');`,
    );
  });
  afterAll(async () => h.close());

  it("REJECTS rewriting sent_at on a sent run (the send-time audit is immutable)", async () => {
    await expect(
      h.query(`update dispatch_run set sent_at='1999-01-01' where id=${runId};`),
    ).rejects.toThrow(/append-only|immutable|blocked|send columns/i);
  });

  it("REJECTS overwriting an existing sent_channel on a sent run", async () => {
    await expect(
      h.query(`update dispatch_run set sent_channel='sms' where id=${runId};`),
    ).rejects.toThrow(/append-only|immutable|blocked|send columns/i);
  });

  it("STILL allows the idempotent re-send (mark_dispatch_sent on the already-sent run)", async () => {
    await h.query(
      `select mark_dispatch_sent(${runId},'web-share',${DEV},'srv',42,'sent-2');`,
    );
    const rows = await h.query<{ status: string; sent_channel: string; sent_at: string }>(
      `select status, sent_channel, sent_at::text from dispatch_run where id=${runId};`,
    );
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_channel).toBe("web-share");
  });
});
