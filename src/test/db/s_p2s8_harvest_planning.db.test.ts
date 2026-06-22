// P2-S8 — Ripeness-aware harvest planning & pasada scheduler: SQL tests that
// replay the REAL phase-1 migrations + this slice's migration in PGlite and prove
// the data-layer invariants of the planner (DESIGN P2-S8 + the carried cross-slice
// rails — AD-8 grants, append-only/superseded plans, derived-never-typed readiness,
// the command-RPC write door):
//
//   - record_maturation_signal: the ONLY writer of plot_phenology + the append-only
//     maturation_signal ledger; idempotent on idempotency_key; authenticated-only
//     (anon EXECUTE denied — the S3 SECURITY-DEFINER lesson).
//   - readiness is DERIVED, never typed: v_harvest_readiness computes a [0,1] score
//     from GDD/phenology/NDVI; a plot with met GDD outranks one short of it; the
//     altitude gradient staggers the predicted ready dates (lower ripens first).
//   - schedule_pasada FIRES a task onto the REAL phase-1 `tasks` board (one row,
//     valid worker_id + category), appends a pasada_schedule row, idempotent.
//   - pasada plans are APPEND-ONLY / SUPERSEDED: replan_pasada writes a NEW version
//     and marks the prior superseded — never an UPDATE/DELETE of history.
//   - AD-8 grant posture: new tables/views SELECT-granted to authenticated; no write
//     table grants; nothing to anon; RPCs revoke PUBLIC execute then grant authenticated.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

const SEED = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");

// The PGlite harness replays the migrations but NOT seed.sql, so each test seeds
// the fixtures it needs (the established db-test convention here). We seed real
// plots spanning the gradient (cuesta-piedra @ 1360 floor … las-lagunas @ 1700
// ceiling), a worker for the fired-task assignee, and a couple of harvests so the
// picker-resolution + recent-ripeness paths have data.
const sql = (s: string) => s;

/** Insert the real Janson plots that span the altitude gradient + a worker + harvests. */
async function seedFixtures(h: Harness): Promise<void> {
  await h.query(sql(`
    insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
                       shade_pct, established_year, status, last_inspected,
                       expected_yield_kg, harvested_kg) values
      ('p-cuesta-piedra', 8, 'Cuesta de Piedra', 'Block E', 'Catuaí', 4.4, 1360, 16500, 33, 2010, 'watch',   '2026-06-13', 19800, 11200),
      ('p-talamanca',     2, 'Talamanca',        'Block B', 'Caturra',6.5, 1520, 24500, 40, 2009, 'healthy', '2026-06-19', 31000, 22800),
      ('p-bambito',       5, 'Bambito',          'Block C', 'Caturra',4.9, 1560, 18400, 42, 2012, 'watch',   '2026-06-18', 22000, 13900),
      ('p-las-lagunas',   6, 'Las Lagunas',      'Block D', 'Geisha', 2.6, 1700,  8600, 60, 2018, 'healthy', '2026-06-19',  9800,  6500)
    on conflict (id) do nothing;
  `));
  await h.query(sql(`
    insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
      ('w-01', 'Miguel Janson', 'Supervisor', 42, 'present', 2009, '+507 6500-1209', 0, 'Field Ops'),
      ('w-06', 'Ana Pérez',     'Picker',     22, 'present', 2018, '+507 6500-0006', 0, 'Norte'),
      ('w-07', 'Luis Mora',     'Picker',     22, 'present', 2019, '+507 6500-0007', 0, 'Sur')
    on conflict (id) do nothing;
  `));
  // Two harvests so _resolve_pasada_worker's tier-1 ("the PLOT's most-recent picker")
  // is actually distinguishable from "any plot's most-recent picker": w-06 is
  // p-cuesta-piedra's picker, while w-07 has a MORE-RECENT harvest on a DIFFERENT plot
  // (p-talamanca). A correct tier-1 resolves p-cuesta-piedra → w-06; the wrong-plot
  // mutant (`where h.plot_id is not null`) would resolve → w-07 (review MED 50).
  await h.query(sql(`insert into lots (code) values ('JC-901') on conflict (code) do nothing;`));
  await h.query(sql(`insert into lots (code) values ('JC-902') on conflict (code) do nothing;`));
  await h.query(sql(`
    insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code) values
      ('hv-p2s8-1', '2026-06-19', 'p-cuesta-piedra', 'w-06', 120, 94, 23.1, 'JC-901'),
      ('hv-p2s8-2', '2026-06-20', 'p-talamanca',     'w-07', 110, 92, 22.7, 'JC-902')
    on conflict (id) do nothing;
  `));
}

describe("P2-S8 — record_maturation_signal (the only phenology writer, idempotent)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("writes plot_phenology + appends a maturation_signal ledger row", async () => {
    await h.query(
      sql(`select record_maturation_signal(
        'p-cuesta-piedra', '2026-01-15', 2200, 0.72, '2026-06-21T12:00:00Z',
        'dev-test', 1, 'mat-cuesta-1'
      );`),
    );
    const phen = await h.query<{ gdd_accumulated: number; ndvi_latest: number }>(
      sql(`select gdd_accumulated, ndvi_latest from plot_phenology where plot_id = 'p-cuesta-piedra';`),
    );
    expect(Number(phen[0].gdd_accumulated)).toBe(2200);
    expect(Number(phen[0].ndvi_latest)).toBeCloseTo(0.72, 5);

    const led = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from maturation_signal where plot_id = 'p-cuesta-piedra';`),
    );
    expect(led[0].n).toBe(1);
  });

  it("is exactly-once on idempotency_key — a replay appends NO second ledger row", async () => {
    // same idempotency_key as above
    await h.query(
      sql(`select record_maturation_signal(
        'p-cuesta-piedra', '2026-01-15', 2200, 0.72, '2026-06-21T12:00:00Z',
        'dev-test', 1, 'mat-cuesta-1'
      );`),
    );
    const led = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from maturation_signal where idempotency_key = 'mat-cuesta-1';`),
    );
    expect(led[0].n).toBe(1);
  });

  it("the maturation_signal ledger is append-only (UPDATE blocked)", async () => {
    await expect(
      h.query(sql(`update maturation_signal set gdd_accumulated = 9999 where plot_id = 'p-cuesta-piedra';`)),
    ).rejects.toThrow(/append-only|immutable|not permitted/i);
  });

  it("the maturation_signal ledger is append-only (DELETE blocked — the other guard arm)", async () => {
    // parity with the UPDATE arm above: maturation_signal_no_delete must reject a
    // raw DELETE, or the ledger's immutability is only half-pinned (a future edit
    // dropping the no_delete trigger would otherwise leave the suite green).
    await expect(
      h.query(sql(`delete from maturation_signal where plot_id = 'p-cuesta-piedra';`)),
    ).rejects.toThrow(/append-only|immutable|not permitted/i);
  });

  it("anon cannot execute record_maturation_signal (S3 grant lesson — fail-closed)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          sql(`select record_maturation_signal(
            'p-las-lagunas', '2026-01-15', 100, null, now(), 'evil', 1, 'mat-evil'
          );`),
        ),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});

describe("P2-S8 — v_harvest_readiness (DERIVED readiness, altitude-staggered)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    // Floor plot: GDD fully met. Ceiling plot: same GDD met BUT higher altitude.
    await h.query(
      sql(`select record_maturation_signal('p-cuesta-piedra','2026-01-15',2200,null,now(),'d',1,'r-floor');`),
    );
    await h.query(
      sql(`select record_maturation_signal('p-las-lagunas','2026-01-15',2200,null,now(),'d',2,'r-ceiling');`),
    );
    // A third plot SHORT of the GDD requirement — should rank below the two met ones.
    await h.query(
      sql(`select record_maturation_signal('p-talamanca','2026-01-15',800,null,now(),'d',3,'r-short');`),
    );
  });
  afterAll(async () => h.close());

  it("ranks a GDD-met plot above a GDD-short plot (readiness is derived from GDD)", async () => {
    const rows = await h.query<{ plot_id: string; readiness: number }>(
      sql(`select plot_id, readiness from v_harvest_readiness order by readiness desc;`),
    );
    const cuesta = rows.find((r) => r.plot_id === "p-cuesta-piedra")!;
    const tala = rows.find((r) => r.plot_id === "p-talamanca")!;
    expect(Number(cuesta.readiness)).toBeGreaterThan(Number(tala.readiness));
  });

  it("readiness is clamped to [0,1] (never a raw ratio above 1)", async () => {
    const rows = await h.query<{ readiness: number }>(
      sql(`select readiness from v_harvest_readiness;`),
    );
    for (const r of rows) {
      expect(Number(r.readiness)).toBeGreaterThanOrEqual(0);
      expect(Number(r.readiness)).toBeLessThanOrEqual(1);
    }
  });

  it("staggers the predicted ready date later for the higher plot (lower ripens first)", async () => {
    const rows = await h.query<{ plot_id: string; predicted_ready_date: string | null }>(
      sql(`select plot_id, predicted_ready_date from v_harvest_readiness
           where plot_id in ('p-cuesta-piedra','p-las-lagunas');`),
    );
    const low = rows.find((r) => r.plot_id === "p-cuesta-piedra")!;
    const high = rows.find((r) => r.plot_id === "p-las-lagunas")!;
    expect(low.predicted_ready_date).not.toBeNull();
    expect(high.predicted_ready_date).not.toBeNull();
    expect(new Date(high.predicted_ready_date as string).getTime()).toBeGreaterThan(
      new Date(low.predicted_ready_date as string).getTime(),
    );
  });

  it("includes EVERY plot (a plot with no signal still appears, honestly low/unknown)", async () => {
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from v_harvest_readiness;`),
    );
    const plots = await h.query<{ n: number }>(sql(`select count(*)::int as n from plots;`));
    expect(rows[0].n).toBe(plots[0].n);
  });
});

describe("P2-S8 — schedule_pasada FIRES a task onto the real phase-1 tasks board", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await h.query(
      sql(`select record_maturation_signal('p-cuesta-piedra','2026-01-15',2200,0.7,now(),'d',1,'sp-sig');`),
    );
  });
  afterAll(async () => h.close());

  it("appends a pasada_schedule row AND inserts ONE task on the existing tasks table", async () => {
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));

    await h.query(
      sql(`select schedule_pasada(
        'p-cuesta-piedra', '2026', 1, '2026-04-01', 'high',
        now(), 'd', 2, 'pasada-1'
      );`),
    );

    const plan = await h.query<{ n: number; status: string }>(
      sql(`select count(*)::int as n, max(status) as status from pasada_schedule
           where plot_id = 'p-cuesta-piedra' and pasada_number = 1;`),
    );
    expect(plan[0].n).toBe(1);

    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n + 1);

    // the fired task is a REAL tasks row: valid worker_id (NOT NULL), valid plot, a due date.
    const task = await h.query<{
      worker_id: string;
      plot_id: string;
      due: string;
      title: string;
      category: string;
    }>(
      sql(`select worker_id, plot_id, due, title, category from tasks
           where plot_id = 'p-cuesta-piedra' order by created_at desc limit 1;`),
    );
    // tier-1 resolution: the assignee is THIS PLOT's most-recent picker (w-06), NOT
    // merely "some worker" and NOT the most-recent picker of a DIFFERENT plot (w-07,
    // who has a more-recent harvest on p-talamanca). `toBe('w-06')` kills the
    // wrong-plot mutant `where h.plot_id is not null` that `toBeTruthy()` let survive.
    expect(task[0].worker_id).toBe("w-06");
    expect(task[0].plot_id).toBe("p-cuesta-piedra");
    expect(task[0].due).toBeTruthy();
    expect(task[0].title.toLowerCase()).toMatch(/pasada|pick|harvest/);
  });

  it("is exactly-once — a replay fires NO second task and writes NO second plan", async () => {
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    await h.query(
      sql(`select schedule_pasada(
        'p-cuesta-piedra', '2026', 1, '2026-04-01', 'high',
        now(), 'd', 2, 'pasada-1'
      );`),
    );
    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n);
    const plan = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where idempotency_key = 'pasada-1';`),
    );
    expect(plan[0].n).toBe(1);
  });

  it("anon cannot schedule a pasada (authenticated-only command door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          sql(`select schedule_pasada('p-las-lagunas','2026',1,'2026-04-15','medium',now(),'evil',1,'p-evil');`),
        ),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});

describe("P2-S8 — _resolve_pasada_worker tier fallbacks (the fired-task assignee is NEVER null)", () => {
  // The fired task's assignee is resolved by tier: (1) the PLOT's most-recent picker,
  // (2) else any Supervisor, (3) else any worker. tasks.worker_id is NOT NULL, so
  // tier-3 is the last-resort guarantee. The happy-path schedule_pasada test pins
  // tier-1 (w-06); these pin tiers 2 and 3 so the documented fallback chain is real
  // behavior, not an unasserted side-effect (review MED 50).
  let h: Harness;
  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterEach(async () => h.close());

  it("tier-2: a plot with NO harvest (so no picker) fires a task assigned to the Supervisor (w-01)", async () => {
    // p-bambito has a phenology signal but NO harvest → no plot picker → tier-2 fires.
    await h.query(
      sql(`select record_maturation_signal('p-bambito','2026-01-15',2200,0.7,now(),'d',1,'t2-sig');`),
    );
    await h.query(
      sql(`select schedule_pasada('p-bambito','2026',1,'2026-04-01','high',now(),'d',2,'t2-plan');`),
    );
    const task = await h.query<{ worker_id: string }>(
      sql(`select worker_id from tasks where plot_id = 'p-bambito' order by created_at desc limit 1;`),
    );
    expect(task[0].worker_id).toBe("w-01");
  });

  it("tier-3: NO picker AND NO supervisor still fires a task with a non-null worker_id (the NOT-NULL last resort)", async () => {
    // Strip the world down to a single non-picker, non-supervisor worker and no
    // harvests, so only tier-3 (any worker) can satisfy the NOT-NULL assignee.
    await h.query(sql(`delete from harvests;`));
    await h.query(sql(`delete from workers;`));
    await h.query(sql(`
      insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
      values ('w-99', 'Solo Hand', 'Picker', 20, 'present', 2020, '+507 6500-0099', 0, 'Sur')
      on conflict (id) do nothing;
    `));
    await h.query(
      sql(`select record_maturation_signal('p-las-lagunas','2026-01-15',2200,0.7,now(),'d',1,'t3-sig');`),
    );
    await h.query(
      sql(`select schedule_pasada('p-las-lagunas','2026',1,'2026-04-01','high',now(),'d',2,'t3-plan');`),
    );
    const task = await h.query<{ worker_id: string }>(
      sql(`select worker_id from tasks where plot_id = 'p-las-lagunas' order by created_at desc limit 1;`),
    );
    expect(task[0].worker_id).toBe("w-99");
  });
});

describe("P2-S8 — replan_pasada is append-only/superseded (re-plan around rain)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await h.query(
      sql(`select record_maturation_signal('p-bambito','2026-01-15',2200,null,now(),'d',1,'rp-sig');`),
    );
    // initial plan
    await h.query(
      sql(`select schedule_pasada('p-bambito','2026',1,'2026-04-01','high',now(),'d',2,'rp-v1');`),
    );
  });
  afterAll(async () => h.close());

  it("a re-plan writes a NEW version and marks the prior plan superseded (history kept)", async () => {
    await h.query(
      sql(`select replan_pasada('p-bambito','2026',1,'2026-04-08','rain front', now(),'d',3,'rp-v2');`),
    );

    // both rows still exist — the original is never deleted/updated-away.
    const all = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where plot_id='p-bambito' and pasada_number=1;`),
    );
    expect(all[0].n).toBe(2);

    // exactly one ACTIVE (non-superseded) plan remains, and it's the new date.
    const active = await h.query<{ ready: string; status: string }>(
      sql(`select to_char(predicted_ready_date, 'YYYY-MM-DD') as ready, status from pasada_schedule
           where plot_id='p-bambito' and pasada_number=1 and status <> 'superseded';`),
    );
    expect(active.length).toBe(1);
    expect(active[0].ready).toBe("2026-04-08");
  });

  it("v_pasada_calendar surfaces only the ACTIVE plan per (plot, pasada)", async () => {
    const cal = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from v_pasada_calendar where plot_id='p-bambito' and pasada_number=1;`),
    );
    expect(cal[0].n).toBe(1);
  });

  // The supersede happy-path above proves the ALLOWED arm of pasada_schedule_guard.
  // These two pin the REJECTED arms directly — the slice's append-only invariant:
  // the morning's plan can never be edited away in place, only superseded by a NEW
  // row. Without these, dropping `pasada_schedule_supersede_only` (so a caller could
  // silently re-date active history in place) or `pasada_schedule_no_delete` (so a
  // caller could delete plan history) leaves the whole suite green (review HIGH 49).
  it("the pasada_schedule ledger is append-only — a direct in-place re-date UPDATE is rejected", async () => {
    await expect(
      h.query(sql(`update pasada_schedule set predicted_ready_date = '2026-05-01'
                   where plot_id='p-bambito' and pasada_number=1 and status <> 'superseded';`)),
    ).rejects.toThrow(/append-only/i);
  });

  it("the pasada_schedule ledger is append-only — a direct DELETE is rejected", async () => {
    await expect(
      h.query(sql(`delete from pasada_schedule where plot_id='p-bambito' and pasada_number=1;`)),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("P2-S8 — single-active-plan invariant (review HIGH idx 71 / MED idx 72,114,167)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await h.query(
      sql(`select record_maturation_signal('p-cuesta-piedra','2026-01-15',2200,0.7,now(),'d',1,'dup-sig');`),
    );
  });
  afterEach(async () => h.close());

  it("rejects a SECOND schedule_pasada (distinct key) for the same (plot, pasada) — no duplicate active plan, no duplicate fired task", async () => {
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));

    await h.query(
      sql(`select schedule_pasada('p-cuesta-piedra','2026',1,'2026-04-01','high',now(),'d',2,'dup-1');`),
    );

    // a second schedule for the SAME pass with a DIFFERENT idempotency key must be rejected.
    await expect(
      h.query(
        sql(`select schedule_pasada('p-cuesta-piedra','2026',1,'2026-04-05','high',now(),'d',3,'dup-2');`),
      ),
    ).rejects.toThrow(/already scheduled|already planned|re-plan/i);

    // exactly ONE active plan, exactly ONE fired Harvest task (the duplicate never landed).
    const active = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule
           where plot_id='p-cuesta-piedra' and pasada_number=1 and status <> 'superseded';`),
    );
    expect(active[0].n).toBe(1);

    const cal = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from v_pasada_calendar where plot_id='p-cuesta-piedra' and pasada_number=1;`),
    );
    expect(cal[0].n).toBe(1);

    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n + 1);
  });

  it("a legitimate replan_pasada STILL succeeds and leaves exactly one active plan (the guard does not break re-planning)", async () => {
    await h.query(
      sql(`select schedule_pasada('p-cuesta-piedra','2026',1,'2026-04-01','high',now(),'d',2,'rp-ok-1');`),
    );
    await h.query(
      sql(`select replan_pasada('p-cuesta-piedra','2026',1,'2026-04-08','rain front',now(),'d',3,'rp-ok-2');`),
    );
    // history kept (2 rows), exactly one active.
    const all = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where plot_id='p-cuesta-piedra' and pasada_number=1;`),
    );
    expect(all[0].n).toBe(2);
    const active = await h.query<{ ready: string }>(
      sql(`select to_char(predicted_ready_date,'YYYY-MM-DD') as ready from pasada_schedule
           where plot_id='p-cuesta-piedra' and pasada_number=1 and status <> 'superseded';`),
    );
    expect(active.length).toBe(1);
    expect(active[0].ready).toBe("2026-04-08");
  });
});

describe("P2-S8 — exactly-once cannot be silently disabled by a NULL idempotency_key (review LOW idx 16,17,116)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterEach(async () => h.close());

  it("record_maturation_signal rejects a NULL idempotency_key (exactly-once must not depend on a non-null key)", async () => {
    await expect(
      h.query(
        sql(`select record_maturation_signal('p-cuesta-piedra','2026-01-15',1000,null,now(),'d',1,null);`),
      ),
    ).rejects.toThrow(/idempotency_key (is )?required/i);
  });

  it("schedule_pasada rejects a NULL idempotency_key", async () => {
    await expect(
      h.query(
        sql(`select schedule_pasada('p-cuesta-piedra','2026',1,'2026-04-01','high',now(),'d',1,null);`),
      ),
    ).rejects.toThrow(/idempotency_key (is )?required/i);
  });

  it("replan_pasada rejects a NULL idempotency_key", async () => {
    await expect(
      h.query(
        sql(`select replan_pasada('p-cuesta-piedra','2026',1,'2026-04-01','rain',now(),'d',1,null);`),
      ),
    ).rejects.toThrow(/idempotency_key (is )?required/i);
  });
});

describe("P2-S8 — pasada_schedule supersede guard pins the audit columns (review LOW idx 73)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await h.query(
      sql(`select record_maturation_signal('p-bambito','2026-01-15',2200,null,now(),'d',1,'g-sig');`),
    );
    await h.query(
      sql(`select schedule_pasada('p-bambito','2026',1,'2026-04-01','high',now(),'d',2,'g-v1');`),
    );
  });
  afterEach(async () => h.close());

  it("rejects a supersede UPDATE that ALSO rewrites an audit column (idempotency_key / fired_task_id / season)", async () => {
    // the only legal UPDATE is the supersede STAMP (status + superseded_by). An
    // UPDATE that flips status->superseded while also mutating idempotency_key must
    // be rejected — otherwise the exactly-once anchor can be silently rewritten.
    await expect(
      h.query(
        sql(`update pasada_schedule set status='superseded', idempotency_key='tampered', fired_task_id=null, season='HACKED'
             where plot_id='p-bambito' and pasada_number=1 and status <> 'superseded';`),
      ),
    ).rejects.toThrow(/append-only|only the supersede stamp/i);

    // the row's audit fields are untouched.
    const row = await h.query<{ idempotency_key: string; season: string }>(
      sql(`select idempotency_key, season from pasada_schedule where idempotency_key='g-v1';`),
    );
    expect(row.length).toBe(1);
    expect(row[0].season).toBe("2026");
  });

  it("still permits the legitimate supersede stamp (status + superseded_by only)", async () => {
    await h.query(
      sql(`select replan_pasada('p-bambito','2026',1,'2026-04-08','rain front',now(),'d',3,'g-v2');`),
    );
    const superseded = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule
           where plot_id='p-bambito' and pasada_number=1 and status='superseded' and superseded_by is not null;`),
    );
    expect(superseded[0].n).toBe(1);
  });
});

describe("P2-S8 — fired_task_id FKs the tasks board with on-delete-set-null (review LOW idx 168)", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await h.query(
      sql(`select record_maturation_signal('p-talamanca','2026-01-15',2200,null,now(),'d',1,'fk-sig');`),
    );
    await h.query(
      sql(`select schedule_pasada('p-talamanca','2026',1,'2026-04-01','high',now(),'d',2,'fk-v1');`),
    );
  });
  afterEach(async () => h.close());

  it("deleting the fired task NULLs pasada_schedule.fired_task_id instead of leaving a dangling pointer", async () => {
    const before = await h.query<{ fired_task_id: string }>(
      sql(`select fired_task_id from pasada_schedule where idempotency_key='fk-v1';`),
    );
    const taskId = before[0].fired_task_id;
    expect(taskId).toBeTruthy();

    // the convention-sanctioned free delete of a phase-1 task must still be allowed
    // (on delete set null, NOT a blocking FK).
    await h.query(sql(`delete from tasks where id = '${taskId}';`));

    const after = await h.query<{ fired_task_id: string | null }>(
      sql(`select fired_task_id from pasada_schedule where idempotency_key='fk-v1';`),
    );
    // the append-only plan row survives, but its broken link is now NULL, not a phantom id.
    expect(after.length).toBe(1);
    expect(after[0].fired_task_id).toBeNull();
  });
});

describe("P2-S8 — AD-8 grant posture (the carried cross-slice rail)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("authenticated can SELECT the new tables/views; anon cannot", async () => {
    for (const rel of ["plot_phenology", "maturation_signal", "pasada_schedule", "v_harvest_readiness", "v_pasada_calendar"]) {
      // authenticated reads (0+ rows, no permission error)
      const ok = await h.query<{ n: number }>(`select count(*)::int as n from ${rel};`);
      expect(ok[0].n).toBeGreaterThanOrEqual(0);
      // anon is denied
      await expect(
        asAnon(h, (hh) => hh.query(`select * from ${rel} limit 1;`)),
      ).rejects.toThrow(/permission denied|denied/i);
    }
  });

  it("no role holds INSERT/UPDATE/DELETE on the new tables (writes go via the RPCs only)", async () => {
    const grants = await h.query<{ privilege_type: string; grantee: string; table_name: string }>(
      sql(`select privilege_type, grantee, table_name
           from information_schema.role_table_grants
           where table_name in ('plot_phenology','maturation_signal','pasada_schedule')
             and grantee in ('anon','authenticated')
             and privilege_type in ('INSERT','UPDATE','DELETE');`),
    );
    expect(grants).toEqual([]);
  });

  it("the 'Harvest' task_category enum add is idempotent (re-applying ADD VALUE IF NOT EXISTS is a no-op)", async () => {
    // The migration extends a shared phase-1 domain type with `alter type
    // task_category add value if not exists 'Harvest'`. The IF NOT EXISTS clause is
    // the ONLY thing making a re-apply safe; a future edit dropping it (plain `add
    // value 'Harvest'`) would error on the second apply (the replay scenario). Pin it:
    // a second ADD VALUE must not throw, and 'Harvest' stays a single enum member.
    await expect(
      h.query(sql(`alter type task_category add value if not exists 'Harvest';`)),
    ).resolves.toBeDefined();
    const members = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pg_enum e
             join pg_type t on t.oid = e.enumtypid
            where t.typname = 'task_category' and e.enumlabel = 'Harvest';`),
    );
    expect(members[0].n).toBe(1);
  });
});

describe("P2-S8 — the PHI gate: the planner can NEVER schedule a pick inside an active PHI window (S12 cross-slice invariant)", () => {
  // The S12 slice stamps phi_clears_on on every spray "so the harvest planner can
  // never schedule a pick inside an active PHI window" (20260622106000 header). That
  // invariant was UNENFORCED: schedule_pasada / replan_pasada fired a Harvest pick
  // task with due = the predicted ready date and never consulted v_plot_phi_status —
  // so a pick could land squarely inside a live pre-harvest interval (a pesticide-
  // residue / Best-of-Panama compliance hole). The forward migration
  // 20260623110000_phi_planner_gate.sql `create or replace`s both RPCs to fail closed.
  //
  // The gate is PICK-DATE-relative, not today-relative: it blocks when the proposed
  // pick date is strictly before the plot's phi_clears_on (the first day a pick is
  // allowed), so a far-future pick that is still inside the window is rejected while a
  // pick ON or AFTER the clear date succeeds.
  let h: Harness;

  /** Log a real cert-gated spray with a multi-day PHI, applied just now (within the
   *  applied_at clamp), so v_plot_phi_status.phi_clears_on ≈ current_date + phiDays. */
  async function sprayPlot(plotId: string, phiDays: number, key: string): Promise<void> {
    // w-agro needs a valid pesticide-handling cert (the log_spray GATE 1). Grant it via
    // a direct table insert — the test session owns the schema / bypasses RLS, the
    // established convention in s_p2s12_remote_sensing_ipm.db.test.ts.
    await h.query(sql(`
      insert into worker_certifications (worker_id, cert_kind, issued_at, expires_at, issuer)
      values ('w-agro', 'pesticide-handling', '2025-01-01', '2030-12-31', 'MIDA Panamá')
      on conflict do nothing;
    `));
    await h.query(
      sql(`select log_spray('${plotId}', 'Verdadero 600', 'imidacloprid', ${phiDays}, 0,
                            now() - interval '1 hour', 'w-agro', 'spray-dev', ${phiDays}, '${key}');`),
    );
  }

  beforeEach(async () => {
    h = await freshDb();
    await seedFixtures(h);
    // w-agro is the certified applicator (not in the S8 base seed — add it).
    await h.query(sql(`
      insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
      values ('w-agro','Lucía Mendez','Agronomist',38,'present',2015,'+507 6500-0042',0,'Field Ops')
      on conflict (id) do nothing;
    `));
    await h.query(
      sql(`select record_maturation_signal('p-talamanca','2026-01-15',2200,0.7,now(),'d',1,'phi-sig');`),
    );
  });
  afterEach(async () => h.close());

  it("schedule_pasada RAISES when the predicted pick date lands INSIDE an active PHI window — and fires NO task / writes NO plan", async () => {
    await sprayPlot("p-talamanca", 14, "phi-spray-sched"); // phi_clears_on ≈ current_date + 14
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));

    // a pick 3 days out is 11 days inside the toxic window → must be refused.
    await expect(
      h.query(
        sql(`select schedule_pasada('p-talamanca','2026',1,(current_date + 3),'high',now(),'d',2,'sched-in-phi');`),
      ),
    ).rejects.toThrow(/PHI|pre-harvest|pasada gate|harvest gate/i);

    // fail-closed: no plan row, no fired Harvest task landed.
    const plan = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where idempotency_key = 'sched-in-phi';`),
    );
    expect(plan[0].n).toBe(0);
    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n);
  });

  it("schedule_pasada SUCCEEDS for a pick date ON/AFTER phi_clears_on (the boundary control — a pick once it clears is fine)", async () => {
    await sprayPlot("p-talamanca", 14, "phi-spray-sched-ok"); // phi_clears_on ≈ current_date + 14
    // a pick 30 days out is past the cleared date → must succeed.
    await h.query(
      sql(`select schedule_pasada('p-talamanca','2026',1,(current_date + 30),'high',now(),'d',2,'sched-post-phi');`),
    );
    const plan = await h.query<{ n: number; status: string }>(
      sql(`select count(*)::int as n, max(status) as status from pasada_schedule
           where idempotency_key = 'sched-post-phi';`),
    );
    expect(plan[0].n).toBe(1);
    const task = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from tasks where category = 'Harvest' and plot_id = 'p-talamanca';`),
    );
    expect(task[0].n).toBe(1);
  });

  it("a plot with NO open PHI window schedules normally (the gate does not over-block)", async () => {
    // no spray on p-talamanca → no v_plot_phi_status row → schedule must succeed.
    await h.query(
      sql(`select schedule_pasada('p-talamanca','2026',1,(current_date + 3),'high',now(),'d',2,'sched-no-phi');`),
    );
    const plan = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where idempotency_key = 'sched-no-phi';`),
    );
    expect(plan[0].n).toBe(1);
  });

  it("replan_pasada RAISES when the NEW ready date lands INSIDE an active PHI window — and fires NO task / writes NO new plan", async () => {
    // an initial plan exists OUTSIDE any PHI window, then a re-plan tries to move the
    // pick INTO a freshly-opened window (the rain-front path most likely to move a date).
    await h.query(
      sql(`select schedule_pasada('p-talamanca','2026',1,(current_date + 60),'high',now(),'d',2,'replan-base');`),
    );
    await sprayPlot("p-talamanca", 14, "phi-spray-replan"); // phi_clears_on ≈ current_date + 14
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));

    await expect(
      h.query(
        sql(`select replan_pasada('p-talamanca','2026',1,(current_date + 5),'rain front',now(),'d',3,'replan-in-phi');`),
      ),
    ).rejects.toThrow(/PHI|pre-harvest|pasada gate|harvest gate/i);

    // fail-closed: no new plan row, no new task, and the ORIGINAL plan is untouched
    // (still active, still its original date — the raise rolled the supersede back).
    const planNew = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule where idempotency_key = 'replan-in-phi';`),
    );
    expect(planNew[0].n).toBe(0);
    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n);
    const active = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from pasada_schedule
           where plot_id='p-talamanca' and pasada_number=1 and status <> 'superseded';`),
    );
    expect(active[0].n).toBe(1);
  });

  it("replan_pasada SUCCEEDS for a NEW ready date ON/AFTER phi_clears_on (re-plan around the window, then pick once it clears)", async () => {
    await h.query(
      sql(`select schedule_pasada('p-talamanca','2026',1,(current_date + 60),'high',now(),'d',2,'replan-ok-base');`),
    );
    await sprayPlot("p-talamanca", 14, "phi-spray-replan-ok"); // phi_clears_on ≈ current_date + 14
    await h.query(
      sql(`select replan_pasada('p-talamanca','2026',1,(current_date + 30),'rain front',now(),'d',3,'replan-post-phi');`),
    );
    const active = await h.query<{ ready_diff: number }>(
      sql(`select (predicted_ready_date - current_date) as ready_diff from pasada_schedule
           where plot_id='p-talamanca' and pasada_number=1 and status <> 'superseded';`),
    );
    expect(active.length).toBe(1);
    expect(Number(active[0].ready_diff)).toBe(30);
  });
});

describe("P2-S8 — seed.sql lands real planner data (the /plan page is exercisable on a fresh install)", () => {
  // REGRESSION (review HIGH idx 160): on a fresh seed with NO phenology, every plot
  // rendered ~0% / "No bloom logged" and the pasada calendar was empty forever — the
  // planner was a wall of meaningless 0% cards. The seed now logs real maturation
  // signals (via the live RPC) and schedules a pasada, so the planner shows genuine
  // staggered readiness and a non-empty calendar.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.db.exec(SEED);
  });
  afterAll(async () => h.close());

  it("seeds phenology so v_harvest_readiness shows REAL (non-zero) staggered readiness", async () => {
    // at least one plot is meaningfully ripe (not the all-0% wall).
    const ranked = await h.query<{ plot_id: string; readiness: string }>(
      `select plot_id, readiness from v_harvest_readiness order by readiness desc;`,
    );
    expect(Number(ranked[0].readiness)).toBeGreaterThan(0.5);
    // the lower/warmer plot outranks the high Geisha (the altitude stagger is visible).
    const cuesta = ranked.find((r) => r.plot_id === "p-cuesta-piedra");
    const lagunas = ranked.find((r) => r.plot_id === "p-las-lagunas");
    expect(cuesta && lagunas).toBeTruthy();
    expect(Number(cuesta!.readiness)).toBeGreaterThan(Number(lagunas!.readiness));
  });

  it("seeds a pasada so v_pasada_calendar is NON-empty and fired a Harvest task", async () => {
    const cal = await h.query<{ n: number }>(
      `select count(*)::int as n from v_pasada_calendar;`,
    );
    expect(cal[0].n).toBeGreaterThanOrEqual(1);
    // the scheduled pass fired a real task onto the phase-1 tasks board.
    const task = await h.query<{ n: number }>(
      `select count(*)::int as n from tasks where category = 'Harvest';`,
    );
    expect(task[0].n).toBeGreaterThanOrEqual(1);
  });
});
