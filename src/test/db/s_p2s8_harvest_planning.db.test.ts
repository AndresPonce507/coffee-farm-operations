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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

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
      ('w-06', 'Ana Pérez',     'Picker',     22, 'present', 2018, '+507 6500-0006', 0, 'Norte')
    on conflict (id) do nothing;
  `));
  // a recent harvest so _resolve_pasada_worker picks the plot's last picker (w-06)
  // and recent-ripeness has a value (single-statement queries — h.query is prepared).
  await h.query(sql(`insert into lots (code) values ('JC-901') on conflict (code) do nothing;`));
  await h.query(sql(`
    insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code) values
      ('hv-p2s8-1', '2026-06-19', 'p-cuesta-piedra', 'w-06', 120, 94, 23.1, 'JC-901')
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
    expect(task[0].worker_id).toBeTruthy();
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
});
