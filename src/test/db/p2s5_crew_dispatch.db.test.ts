// P2-S5 — Morning crew dispatch: SQL tests that replay the REAL migrations
// (phase-1 spine + the full phase-2 foundation + this slice) in PGlite and prove
// the slice's load-bearing data-layer invariants.
//
// What this proves (the DESIGN P2-S5 "Key invariants" + AD-8 + the global
// injection invariant carried verbatim):
//   - GENERATION from the model: generate_dispatch reads v_harvest_readiness (S8) +
//     v_crew_roster (S1) and writes a dispatch_run + per-plot dispatch_assignment
//     rows — "Crew Norte → plots X,Y ripe today" — ripeness-ranked, no hand-set list.
//   - APPEND-ONLY / SUPERSEDED: re-generating a crew's plan for the same date writes
//     a NEW run and stamps the prior one 'superseded' (history is forever auditable);
//     a direct UPDATE/DELETE of a run or an assignment raises.
//   - EXACTLY-ONCE: a replay with the same idempotency_key is a no-op (one run).
//   - THE INJECTION INVARIANT (the load-bearing safety test): there is NO write path
//     from an inbound message to a domain action. The ONLY thing an inbound ack may
//     write is a dispatch_acknowledgement EVIDENCE row — it never advances a run,
//     never fires a task, never mutates an assignment. record_dispatch_ack writes
//     only that evidence table; it cannot reach any command verb.
//   - OWNER-INITIATED OUTBOUND ONLY: mark_dispatch_sent is the deliberate outbound
//     transition (draft → sent); generation never auto-sends.
//   - AD-8 GRANTS: authenticated reads the new views; anon reads NOTHING; the command
//     RPCs execute for authenticated and PUBLIC execute is revoked.
//
// Runs the authenticated/anon roles via the harness so it exercises the live posture.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

const DEV = `'2026-06-22T05:30:00Z'`;
const TODAY = `'2026-06-22'`;

// The migrations create EMPTY tables; seed.sql (run after them in prod) inserts the
// workers and calls _backfill_people(). The PGlite harness replays migrations only —
// so each test seeds the workforce fixture, runs the people backfill, plus a couple
// of plots + phenology so v_harvest_readiness ranks them, then dispatches.
const SEED_WORKERS = `
insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
  ('w-01','Miguel Janson','Supervisor',42,'present',2009,'+507 6500-1209',0,'Field Ops'),
  ('w-03','Eduardo Pérez','Picker',22,'present',2015,'+507 6612-7741',92,'Crew Norte'),
  ('w-04','Rosa Quintero','Picker',22,'present',2016,'+507 6633-1180',84,'Crew Norte'),
  ('w-09','Pedro Caballero','Picker',22,'present',2017,'+507 6699-7712',90,'Crew Norte'),
  ('w-05','Tomás Atencio','Picker',22,'present',2018,'+507 6644-9921',64,'Crew Tizingal');`;

// Two plots with phenology so v_harvest_readiness ranks one clearly ready (high GDD,
// lower altitude) and one not (low GDD, higher altitude). bloom_date is needed for a
// non-low confidence + a predicted date.
const SEED_PLOTS = `
insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg) values
  ('p-norte-1', 1, 'Norte Bajo', 'Norte', 'Catuaí', 1.2, 1400, 3200, 40, 2012, 'healthy', '2026-06-01', 5000, 0),
  ('p-norte-2', 2, 'Norte Alto', 'Norte', 'Geisha', 0.8, 1650, 1800, 55, 2015, 'healthy', '2026-06-01', 2400, 0);`;

async function seedWorld(h: Harness): Promise<void> {
  await h.query(SEED_WORKERS);
  await h.query(SEED_PLOTS);
  await h.query(`select _backfill_people();`);
  // make the lower plot clearly ready, the higher plot not.
  await h.query(
    `select record_maturation_signal('p-norte-1','2026-02-01',2200,0.72,${DEV},'srv',1,'mat-1');`,
  );
  await h.query(
    `select record_maturation_signal('p-norte-2','2026-03-15',600,0.40,${DEV},'srv',2,'mat-2');`,
  );
}

/** The crew id the backfill mints from 'Crew Norte'. */
const CREW_NORTE = `'crew-norte'`;

describe("P2-S5 — generate_dispatch reads the model and writes a per-crew run", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
  });
  afterAll(async () => h.close());

  it("creates a draft dispatch_run for the crew + date", async () => {
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',10,'disp-1');`,
    );
    const runs = await h.query<{ crew_id: string; status: string; dispatch_date: string }>(
      `select crew_id, status, dispatch_date::text from dispatch_run where idempotency_key='disp-1';`,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].crew_id).toBe("crew-norte");
    expect(runs[0].status).toBe("draft");
  });

  it("writes assignments only for plots at/above the readiness threshold (ripe today)", async () => {
    const rows = await h.query<{ plot_id: string }>(
      `select a.plot_id
         from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='disp-1'
        order by a.plot_id;`,
    );
    // p-norte-1 (readiness 1.0) is in; p-norte-2 (~0.27) is below the 0.5 threshold.
    expect(rows.map((r) => r.plot_id)).toEqual(["p-norte-1"]);
  });

  it("snapshots the ripeness band + readiness on each assignment (the card payload)", async () => {
    const rows = await h.query<{ ripeness_target: string; readiness: string }>(
      `select a.ripeness_target, a.readiness
         from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='disp-1';`,
    );
    expect(rows[0].ripeness_target).toBe("high");
    expect(Number(rows[0].readiness)).toBeGreaterThanOrEqual(0.5);
  });

  it("raises on an unknown crew (FK guard inside the RPC)", async () => {
    await expect(
      h.query(
        `select generate_dispatch('crew-nobody',${TODAY},'2026',0.5,${DEV},'srv',11,'disp-x');`,
      ),
    ).rejects.toThrow(/unknown crew/i);
  });

  it("is exactly-once on idempotency_key (a replay creates NO second run)", async () => {
    const first = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',10,'disp-1') as generate_dispatch;`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_run where idempotency_key='disp-1';`,
    );
    expect(n[0].n).toBe(1);
    expect(first[0].generate_dispatch).toBeTruthy();
  });
});

describe("P2-S5 — append-only / superseded re-planning", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',20,'disp-a');`,
    );
  });
  afterAll(async () => h.close());

  it("re-generating supersedes the prior run (history preserved, not edited)", async () => {
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',21,'disp-b');`,
    );
    const prior = await h.query<{ status: string; superseded_by: number | null }>(
      `select status, superseded_by from dispatch_run where idempotency_key='disp-a';`,
    );
    expect(prior[0].status).toBe("superseded");
    expect(prior[0].superseded_by).not.toBeNull();
    // both runs still exist (the old one is preserved, never deleted).
    const n = await h.query<{ n: number }>(`select count(*)::int as n from dispatch_run;`);
    expect(n[0].n).toBe(2);
  });

  it("v_dispatch_today shows only the ACTIVE (non-superseded) run per crew", async () => {
    const rows = await h.query<{ idempotency_key: string }>(
      `select idempotency_key from v_dispatch_today where crew_id='crew-norte';`,
    );
    expect(rows.map((r) => r.idempotency_key)).toEqual(["disp-b"]);
  });

  it("REJECTS re-keying a dispatch_run's identity (crew/date frozen)", async () => {
    // the outbound lifecycle (draft→sent) is sanctioned; re-keying the crew/date a
    // run was planned for is NOT — that would rewrite the morning's plan in place.
    await expect(
      h.query(`update dispatch_run set crew_id='crew-tizingal' where idempotency_key='disp-b';`),
    ).rejects.toThrow(/immutable|append-only|re-plan/i);
  });

  it("REJECTS an illegal status jump (no draft→acknowledged shortcut)", async () => {
    await expect(
      h.query(`update dispatch_run set status='acknowledged' where idempotency_key='disp-b';`),
    ).rejects.toThrow(/lifecycle|blocked|append-only/i);
  });

  it("REJECTS a DELETE of a dispatch_run (append-only)", async () => {
    await expect(
      h.query(`delete from dispatch_run where idempotency_key='disp-b';`),
    ).rejects.toThrow(/append-only|blocked/i);
  });

  it("REJECTS an UPDATE of a dispatch_assignment (append-only)", async () => {
    await expect(
      h.query(`update dispatch_assignment set target_kg = 999;`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
  });

  // ── append-only HOLE regression (reviewer HIGH): the same-status branch must NOT
  // be a window to mutate frozen columns. These all FAIL on the pre-fix guard.
  it("REJECTS mutating a frozen plan input on a same-status UPDATE (readiness_threshold)", async () => {
    await expect(
      h.query(`update dispatch_run set readiness_threshold = 0.99 where idempotency_key='disp-b';`),
    ).rejects.toThrow(/immutable|append-only|frozen|blocked/i);
  });

  it("REJECTS any UPDATE of a SUPERSEDED run (history is terminal, never rewritten)", async () => {
    // disp-a is superseded; re-pointing its supersede link or editing it must raise.
    await expect(
      h.query(`update dispatch_run set superseded_by = null where idempotency_key='disp-a';`),
    ).rejects.toThrow(/immutable|append-only|terminal|superseded|blocked/i);
  });

  it("REJECTS rewriting the sent_channel on a draft via the same-status branch", async () => {
    // disp-b is a draft (status unchanged) — its channel must not be editable until sent.
    await expect(
      h.query(`update dispatch_run set sent_channel = 'whatsapp-cloud' where idempotency_key='disp-b';`),
    ).rejects.toThrow(/immutable|append-only|frozen|lifecycle|blocked/i);
  });
});

describe("P2-S5 — owner-initiated outbound (mark_dispatch_sent)", () => {
  let h: Harness;
  let runId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',30,'disp-s') as generate_dispatch;`,
    );
    runId = r[0].generate_dispatch;
  });
  afterAll(async () => h.close());

  it("generation NEVER auto-sends — the run starts as draft", async () => {
    const rows = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${runId};`,
    );
    expect(rows[0].status).toBe("draft");
  });

  it("mark_dispatch_sent transitions draft → sent and stamps the channel", async () => {
    await h.query(
      `select mark_dispatch_sent(${runId},'web-share',${DEV},'srv',31,'sent-1');`,
    );
    const rows = await h.query<{ status: string; sent_channel: string }>(
      `select status, sent_channel from dispatch_run where id=${runId};`,
    );
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_channel).toBe("web-share");
  });

  it("is exactly-once on the sent idempotency_key (a replay does not double-send)", async () => {
    await h.query(
      `select mark_dispatch_sent(${runId},'web-share',${DEV},'srv',31,'sent-1');`,
    );
    const rows = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${runId};`,
    );
    expect(rows[0].status).toBe("sent");
  });
});

describe("P2-S5 — THE INJECTION INVARIANT (inbound NEVER drives a write)", () => {
  let h: Harness;
  let runId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',40,'disp-i') as generate_dispatch;`,
    );
    runId = r[0].generate_dispatch;
  });
  afterAll(async () => h.close());

  it("record_dispatch_ack writes ONLY an evidence row — it does NOT change the run", async () => {
    const before = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${runId};`,
    );
    await h.query(
      `select record_dispatch_ack(${runId},'w-03','whatsapp-inbound',${DEV},'srv',41,'ack-1');`,
    );
    const acks = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_acknowledgement where dispatch_run_id=${runId};`,
    );
    expect(acks[0].n).toBe(1);
    // the run is UNCHANGED — an inbound ack is recorded, never an action.
    const after = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${runId};`,
    );
    expect(after[0].status).toBe(before[0].status);
  });

  it("an ack does NOT fire a task, advance a pasada, or create an assignment", async () => {
    const tasks = await h.query<{ n: number }>(
      `select count(*)::int as n from tasks;`,
    );
    const assigns = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_assignment where dispatch_run_id=${runId};`,
    );
    // record another ack, confirm NOTHING downstream moved.
    await h.query(
      `select record_dispatch_ack(${runId},'w-04','sms-inbound',${DEV},'srv',42,'ack-2');`,
    );
    const tasksAfter = await h.query<{ n: number }>(
      `select count(*)::int as n from tasks;`,
    );
    const assignsAfter = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_assignment where dispatch_run_id=${runId};`,
    );
    expect(tasksAfter[0].n).toBe(tasks[0].n);
    expect(assignsAfter[0].n).toBe(assigns[0].n);
  });

  it("acknowledgements are append-only (an inbound row can never be mutated)", async () => {
    await expect(
      h.query(`update dispatch_acknowledgement set channel='spoofed';`),
    ).rejects.toThrow(/append-only|immutable|blocked/i);
    await expect(
      h.query(`delete from dispatch_acknowledgement where idempotency_key='ack-1';`),
    ).rejects.toThrow(/append-only|blocked/i);
  });

  it("is exactly-once on the ack idempotency_key (a replayed inbound is one row)", async () => {
    await h.query(
      `select record_dispatch_ack(${runId},'w-03','whatsapp-inbound',${DEV},'srv',41,'ack-1');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from dispatch_acknowledgement where idempotency_key='ack-1';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("an inbound ack on a SENT run does NOT auto-acknowledge it (the guard-permitted transition the inbound writer must never reach)", async () => {
    // The block above acks DRAFT runs, so it only proves draft→draft. dispatch_run_guard()
    // explicitly PERMITS sent→acknowledged, so the genuinely dangerous injection is an ack
    // that flips a SENT run to 'acknowledged' — exactly what an attacker's "got it" reply
    // wants. Take a fresh run to 'sent', fire record_dispatch_ack, and pin it STILL 'sent'.
    // This fails the instant any `update dispatch_run set status='acknowledged' where
    // ... status='sent'` creeps into the inbound writer, because the guard would let it land.
    const r = await h.query<{ generate_dispatch: number }>(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',43,'disp-sent-ack') as generate_dispatch;`,
    );
    const id = r[0].generate_dispatch;
    await h.query(`select mark_dispatch_sent(${id},'web-share',${DEV},'srv',44,'sent-ia');`);
    const before = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${id};`,
    );
    expect(before[0].status).toBe("sent"); // precondition: the run really is SENT
    await h.query(
      `select record_dispatch_ack(${id},'w-03','whatsapp-inbound',${DEV},'srv',45,'ack-ia');`,
    );
    const after = await h.query<{ status: string }>(
      `select status from dispatch_run where id=${id};`,
    );
    expect(after[0].status).toBe("sent"); // ONLY a deliberate owner action may set 'acknowledged'
  });
});

describe("P2-S5 — v_dispatch_card renders the per-crew card payload", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',50,'disp-c');`,
    );
  });
  afterAll(async () => h.close());

  it("exposes one card row per active run with crew name, date, and plot count", async () => {
    const rows = await h.query<{
      crew_name: string;
      dispatch_date: string;
      plot_count: number;
      status: string;
    }>(
      `select crew_name, dispatch_date::text, plot_count, status
         from v_dispatch_card where crew_id='crew-norte';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].crew_name).toBe("Crew Norte");
    expect(Number(rows[0].plot_count)).toBe(1);
    expect(rows[0].status).toBe("draft");
  });

  it("the card's plots come back in readiness (pasada) order with their names", async () => {
    const rows = await h.query<{ plot_name: string; ripeness_target: string }>(
      `select a.plot_name, a.ripeness_target
         from v_dispatch_card_plots a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.crew_id='crew-norte' and r.status <> 'superseded'
        order by a.readiness desc;`,
    );
    expect(rows.map((r) => r.plot_name)).toEqual(["Norte Bajo"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P2-S5 named invariant "ripeness-aware assignment correct" — exercised with
// THREE plots that land in the high / medium / low ripeness bands, seeded in an
// order where plot_id sort is the REVERSE of readiness sort. This is the only
// block that proves (1) generate_dispatch stamps `ord` most-ready-first (the
// pasada wave down the altitude gradient) and (2) the readiness→ripeness_target
// CASE buckets all three bands — straight off the SQL, not the TS mapper. The
// single-saturated-plot fixture above can never reach the medium/low branches
// nor a >1-row ord ranking, so a backwards `order by hr.readiness desc` or a
// flipped band threshold would survive it; this block fails the moment either
// breaks.
//
// Readiness math (v_harvest_readiness): with ndvi_latest = 0.6 the NDVI nudge is
// EXACTLY 0 ((0.6-0.6)/0.4 = 0), so readiness = clamp01(gdd_accumulated / 2200).
// Bands (generate_dispatch CASE): >=0.8 high, >=0.45 medium, else low.
//   p-z-high   gdd 2200 -> 1.00 -> 'high'    (ord 1)
//   p-m-medium gdd 1320 -> 0.60 -> 'medium'  (ord 2)
//   p-a-low    gdd  880 -> 0.40 -> 'low'     (ord 3, and >= the 0.3 threshold so it IS assigned)
// plot_id ASC = [p-a-low, p-m-medium, p-z-high] — the REVERSE of readiness DESC —
// so a sort that fell back to plot_id (or ran backwards) would mis-rank ord.
const SEED_PLOTS_3BAND = `
insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg) values
  ('p-a-low',    1, 'Bajo Tardío',   'Norte', 'Catuaí', 1.0, 1300, 2800, 40, 2012, 'healthy', '2026-06-01', 4000, 0),
  ('p-m-medium', 2, 'Medio Centro',  'Norte', 'Catuaí', 1.0, 1320, 2900, 40, 2013, 'healthy', '2026-06-01', 4200, 0),
  ('p-z-high',   3, 'Alto Maduro',   'Norte', 'Geisha', 1.0, 1340, 1900, 50, 2015, 'healthy', '2026-06-01', 2600, 0);`;

async function seedThreeBandWorld(h: Harness): Promise<void> {
  await h.query(SEED_WORKERS);
  await h.query(SEED_PLOTS_3BAND);
  await h.query(`select _backfill_people();`);
  // map all three plots to Crew Norte so generate_dispatch scopes the card to them.
  await h.query(`select assign_crew_plot(${CREW_NORTE},'p-a-low','2026',${DEV},'srv',80,'map-a');`);
  await h.query(`select assign_crew_plot(${CREW_NORTE},'p-m-medium','2026',${DEV},'srv',81,'map-m');`);
  await h.query(`select assign_crew_plot(${CREW_NORTE},'p-z-high','2026',${DEV},'srv',82,'map-z');`);
  // ndvi_latest = 0.6 zeroes the NDVI nudge, so readiness = clamp01(gdd/2200) exactly.
  await h.query(
    `select record_maturation_signal('p-z-high','2026-02-01',2200,0.6,${DEV},'srv',83,'mat-z');`,
  );
  await h.query(
    `select record_maturation_signal('p-m-medium','2026-02-01',1320,0.6,${DEV},'srv',84,'mat-m');`,
  );
  await h.query(
    `select record_maturation_signal('p-a-low','2026-02-01',880,0.6,${DEV},'srv',85,'mat-a');`,
  );
}

describe("P2-S5 — ripeness-aware assignment: ord ranking + high/medium/low bands (SQL, not the mapper)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedThreeBandWorld(h);
    // threshold 0.3 so all three ready plots (1.00 / 0.60 / 0.40) are assigned.
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.3,${DEV},'srv',86,'disp-3band');`,
    );
  });
  afterAll(async () => h.close());

  it("the derived readiness lands each plot in a DISTINCT band (high / medium / low)", async () => {
    const rows = await h.query<{ plot_id: string; readiness: string }>(
      `select hr.plot_id, hr.readiness
         from v_harvest_readiness hr
        where hr.plot_id in ('p-z-high','p-m-medium','p-a-low')
        order by hr.plot_id;`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.plot_id, Number(r.readiness)]));
    // sanity-anchor the fixture so a future formula change that collapses the bands
    // (e.g. all three saturating) fails HERE rather than silently weakening the block.
    expect(byId["p-z-high"]).toBeGreaterThanOrEqual(0.8); // high band
    expect(byId["p-m-medium"]).toBeCloseTo(0.6, 2); // medium band (>=0.45, <0.8)
    expect(byId["p-a-low"]).toBeCloseTo(0.4, 2); // low band (<0.45, but >= 0.3 threshold)
  });

  it("generate_dispatch stamps `ord` most-ready-FIRST (the pasada wave, not plot_id order)", async () => {
    // read straight off dispatch_assignment.ord — the field the card display sort and
    // the bilingual picker card both trust. A backwards `order by hr.readiness desc`
    // (or a fallback to plot_id) would put p-a-low at ord 1 and fail this.
    const rows = await h.query<{ plot_id: string; ord: number; readiness: string }>(
      `select a.plot_id, a.ord, a.readiness
         from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='disp-3band'
        order by a.ord;`,
    );
    expect(rows.map((r) => r.plot_id)).toEqual(["p-z-high", "p-m-medium", "p-a-low"]);
    expect(rows.map((r) => r.ord)).toEqual([1, 2, 3]);
    // ord is monotonic with readiness desc — the most-ready plot is picked first.
    const readiness = rows.map((r) => Number(r.readiness));
    expect(readiness[0]).toBeGreaterThan(readiness[1]);
    expect(readiness[1]).toBeGreaterThan(readiness[2]);
  });

  it("generate_dispatch buckets ripeness_target into high / medium / low off the derived readiness", async () => {
    const rows = await h.query<{ plot_id: string; ripeness_target: string }>(
      `select a.plot_id, a.ripeness_target
         from dispatch_assignment a
         join dispatch_run r on r.id = a.dispatch_run_id
        where r.idempotency_key='disp-3band';`,
    );
    const band = Object.fromEntries(rows.map((r) => [r.plot_id, r.ripeness_target]));
    expect(band["p-z-high"]).toBe("high");
    expect(band["p-m-medium"]).toBe("medium");
    expect(band["p-a-low"]).toBe("low");
  });
});

describe("P2-S5 — AD-8 grants (the live REST posture)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedWorld(h);
    await h.query(
      `select generate_dispatch(${CREW_NORTE},${TODAY},'2026',0.5,${DEV},'srv',60,'disp-g');`,
    );
  });
  afterAll(async () => h.close());

  it("authenticated CAN read the dispatch views", async () => {
    await asAuthenticated(h, async (hh) => {
      const rows = await hh.query<{ crew_id: string }>(
        `select crew_id from v_dispatch_today;`,
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it("anon reads NOTHING (its SELECT grant was never issued)", async () => {
    await asAnon(h, async (hh) => {
      await expect(hh.query(`select * from dispatch_run;`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(hh.query(`select * from v_dispatch_today;`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });

  it("anon CANNOT execute the command RPCs (PUBLIC execute revoked)", async () => {
    await asAnon(h, async (hh) => {
      await expect(
        hh.query(
          `select generate_dispatch('crew-norte',${TODAY},'2026',0.5,${DEV},'srv',99,'disp-anon');`,
        ),
      ).rejects.toThrow(/permission denied/i);
      // record_dispatch_ack is the SINGLE untrusted-inbound write door and the most
      // security-sensitive RPC in the slice: a dropped/fat-fingered `revoke execute ...
      // from public` (or a new overload inheriting PUBLIC execute) would let an
      // UNAUTHENTICATED webhook caller stuff the append-only evidence ledger. The
      // permission check precedes the body, so the bogus run id 1 never matters — a
      // missing revoke surfaces as the function EXECUTING instead of raising 42501.
      await expect(
        hh.query(
          `select record_dispatch_ack(1,'w-03','whatsapp-inbound',${DEV},'srv',99,'ack-anon');`,
        ),
      ).rejects.toThrow(/permission denied/i);
      // mark_dispatch_sent is the owner-only outbound transition — anon must never reach it.
      await expect(
        hh.query(`select mark_dispatch_sent(1,'web-share',${DEV},'srv',99,'sent-anon');`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("authenticated CAN execute generate_dispatch", async () => {
    await asAuthenticated(h, async (hh) => {
      const r = await hh.query<{ generate_dispatch: number }>(
        `select generate_dispatch('crew-norte',${TODAY},'2026',0.5,${DEV},'srv',70,'disp-auth') as generate_dispatch;`,
      );
      expect(r[0].generate_dispatch).toBeTruthy();
    });
  });
});
