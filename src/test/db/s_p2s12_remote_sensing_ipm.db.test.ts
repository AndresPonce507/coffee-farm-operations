// P2-S12 — Satellite NDVI/SAR fusion + IPM scouting + cert/PHI-safe spray log:
// SQL tests that replay the REAL phase-1 + phase-2-foundation migrations + this
// slice's migration in PGlite and prove its data-layer invariants:
//
//   - record_vegetation_index: the ONLY writer of the append-only vegetation
//     series; idempotent on idempotency_key; authenticated-only (anon EXECUTE
//     denied — the S3 SECURITY-DEFINER lesson).
//   - v_plot_vegetation: the HONEST confidence badge — a recent low-cloud optical
//     read is HIGH/optical; a cloudy optical with a SAR read present falls back to
//     MEDIUM/sar; no signal is honestly LOW (never hidden). EVERY plot appears.
//   - record_scouting: fires a control task onto the REAL phase-1 `tasks` board
//     when incidence crosses the economic threshold, and does NOT when below.
//   - THE CERT GATE (the slice's key invariant): log_spray RAISES for a worker with
//     NO cert and for one whose cert is EXPIRED, and SUCCEEDS for a valid cert.
//   - THE PHI/REI GATE: a spray inside an active re-entry window is blocked; a valid
//     spray stamps phi_clears_on so the planner can read the window.
//   - append-only: the ledgers reject UPDATE/DELETE.
//   - AD-8 grant posture: new tables/views SELECT-granted to authenticated; no write
//     table grants; nothing to anon; RPCs revoke PUBLIC execute then grant authenticated.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

const sql = (s: string) => s;

/** Seed real Janson plots spanning the gradient + workers for the spray applicator. */
async function seedFixtures(h: Harness): Promise<void> {
  await h.query(sql(`
    insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
                       shade_pct, established_year, status, last_inspected,
                       expected_yield_kg, harvested_kg) values
      ('p-cuesta-piedra', 8, 'Cuesta de Piedra', 'Block E', 'Catuaí', 4.4, 1360, 16500, 33, 2010, 'watch',   '2026-06-13', 19800, 11200),
      ('p-talamanca',     2, 'Talamanca',        'Block B', 'Caturra',6.5, 1520, 24500, 40, 2009, 'healthy', '2026-06-19', 31000, 22800),
      ('p-las-lagunas',   6, 'Las Lagunas',      'Block D', 'Geisha', 2.6, 1700,  8600, 60, 2018, 'healthy', '2026-06-19',  9800,  6500)
    on conflict (id) do nothing;
  `));
  await h.query(sql(`
    insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew) values
      ('w-01', 'Miguel Janson', 'Supervisor',  42, 'present', 2009, '+507 6500-1209', 0, 'Field Ops'),
      ('w-agro','Lucía Mendez', 'Agronomist',  38, 'present', 2015, '+507 6500-0042', 0, 'Field Ops'),
      ('w-06', 'Ana Pérez',     'Picker',      22, 'present', 2018, '+507 6500-0006', 0, 'Norte')
    on conflict (id) do nothing;
  `));
}

/** Grant a worker a pesticide-handling cert valid through `expires` (table insert —
 *  the test session is the owner / bypasses RLS, the established convention here). */
async function grantCert(h: Harness, workerId: string, expires: string | null): Promise<void> {
  await h.query(sql(`
    insert into worker_certifications (worker_id, cert_kind, issued_at, expires_at, issuer)
    values ('${workerId}', 'pesticide-handling', '2025-01-01', ${expires ? `'${expires}'` : "null"}, 'MIDA Panamá');
  `));
}

// ─────────────────────────── vegetation series + confidence ─────────────────

describe("P2-S12 — record_vegetation_index + v_plot_vegetation (honest confidence)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("appends a vegetation observation; the series is queryable", async () => {
    await h.query(sql(`select record_vegetation_index(
      'p-cuesta-piedra', 'sentinel-2', 'ndvi', 0.78, 5, now() - interval '1 day',
      'ingest', 1, 'veg-1'
    );`));
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from plot_vegetation_index where plot_id = 'p-cuesta-piedra';`),
    );
    expect(rows[0].n).toBe(1);
  });

  it("a recent low-cloud OPTICAL read fuses to HIGH confidence, basis optical", async () => {
    const veg = await h.query<{ confidence: string; basis: string; value: number }>(
      sql(`select confidence, basis, value from v_plot_vegetation where plot_id = 'p-cuesta-piedra';`),
    );
    expect(veg[0].confidence).toBe("high");
    expect(veg[0].basis).toBe("optical");
    expect(Number(veg[0].value)).toBeCloseTo(0.78, 5);
  });

  it("a CLOUDY optical with a SAR read present falls back to MEDIUM confidence, basis sar", async () => {
    // talamanca: only a heavily-clouded optical + a SAR read → SAR must carry it.
    await h.query(sql(`select record_vegetation_index(
      'p-talamanca', 'sentinel-2', 'ndvi', 0.40, 90, now() - interval '1 day', 'ingest', 2, 'veg-cloudy'
    );`));
    await h.query(sql(`select record_vegetation_index(
      'p-talamanca', 'sentinel-1-sar', 'sar-backscatter', 0.61, 0, now() - interval '1 day', 'ingest', 3, 'veg-sar'
    );`));
    const veg = await h.query<{ confidence: string; basis: string; value: number }>(
      sql(`select confidence, basis, value from v_plot_vegetation where plot_id = 'p-talamanca';`),
    );
    expect(veg[0].confidence).toBe("medium");
    expect(veg[0].basis).toBe("sar");
    expect(Number(veg[0].value)).toBeCloseTo(0.61, 5);
  });

  it("a plot with NO observation is honestly LOW confidence (never hidden behind a blank)", async () => {
    const veg = await h.query<{ confidence: string; value: number | null }>(
      sql(`select confidence, value from v_plot_vegetation where plot_id = 'p-las-lagunas';`),
    );
    expect(veg[0].confidence).toBe("low");
    expect(veg[0].value).toBeNull();
  });

  it("EVERY plot appears in v_plot_vegetation (the cloud is never a missing row)", async () => {
    const veg = await h.query<{ n: number }>(sql(`select count(*)::int as n from v_plot_vegetation;`));
    const plots = await h.query<{ n: number }>(sql(`select count(*)::int as n from plots;`));
    expect(veg[0].n).toBe(plots[0].n);
  });

  it("is exactly-once on idempotency_key — a replay appends NO second row", async () => {
    await h.query(sql(`select record_vegetation_index(
      'p-cuesta-piedra', 'sentinel-2', 'ndvi', 0.78, 5, now() - interval '1 day', 'ingest', 1, 'veg-1'
    );`));
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from plot_vegetation_index where idempotency_key = 'veg-1';`),
    );
    expect(rows[0].n).toBe(1);
  });

  it("the vegetation series is append-only (UPDATE blocked)", async () => {
    await expect(
      h.query(sql(`update plot_vegetation_index set value = 9 where plot_id = 'p-cuesta-piedra';`)),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("anon cannot execute record_vegetation_index (authenticated-only door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(sql(`select record_vegetation_index('p-las-lagunas','sentinel-2','ndvi',0.5,0,now(),'evil',1,'veg-evil');`)),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});

// ─────────────────────────── IPM scouting + threshold ──────────────────────

describe("P2-S12 — record_scouting fires a control task at the economic threshold", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("an ABOVE-threshold broca read fires ONE control task on the real tasks board", async () => {
    const before = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    await h.query(sql(`select record_scouting(
      'p-cuesta-piedra', 'broca', 8, 'borings on the south rows', 'w-agro',
      now(), 'scout', 1, 'scout-broca-hi'
    );`));
    const after = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(after[0].n).toBe(before[0].n + 1);

    const obs = await h.query<{ recommend: boolean; fired: string | null }>(
      sql(`select s.fired_task_id as fired, v.recommend
           from scouting_observation s
           join v_ipm_threshold v on v.plot_id = s.plot_id and v.pest_kind = s.pest_kind
           where s.idempotency_key = 'scout-broca-hi';`),
    );
    expect(obs[0].recommend).toBe(true);
    expect(obs[0].fired).toBeTruthy();

    const task = await h.query<{ category: string; worker_id: string; title: string }>(
      sql(`select category, worker_id, title from tasks where plot_id = 'p-cuesta-piedra'
           order by created_at desc limit 1;`),
    );
    expect(task[0].category).toBe("Pest Control");
    expect(task[0].worker_id).toBeTruthy();
    expect(task[0].title.toLowerCase()).toMatch(/broca|ipm|control/);
  });

  it("a BELOW-threshold read records the observation but fires NO task (hold)", async () => {
    const before = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    await h.query(sql(`select record_scouting(
      'p-talamanca', 'broca', 2, 'minor', 'w-agro', now(), 'scout', 2, 'scout-broca-lo'
    );`));
    const after = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(after[0].n).toBe(before[0].n);

    const obs = await h.query<{ recommend: boolean; fired: string | null }>(
      sql(`select fired_task_id as fired,
                  (select recommend from v_ipm_threshold v where v.plot_id='p-talamanca' and v.pest_kind='broca')
                  as recommend
           from scouting_observation where idempotency_key = 'scout-broca-lo';`),
    );
    expect(obs[0].recommend).toBe(false);
    expect(obs[0].fired).toBeNull();
  });

  it("is exactly-once — a replay fires no second task and writes no second observation", async () => {
    const before = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    await h.query(sql(`select record_scouting(
      'p-cuesta-piedra', 'broca', 8, 'borings on the south rows', 'w-agro', now(), 'scout', 1, 'scout-broca-hi'
    );`));
    const after = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    expect(after[0].n).toBe(before[0].n);
    const obs = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from scouting_observation where idempotency_key = 'scout-broca-hi';`),
    );
    expect(obs[0].n).toBe(1);
  });

  it("anon cannot execute record_scouting", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(sql(`select record_scouting('p-las-lagunas','roya',50,null,null,now(),'evil',1,'scout-evil');`)),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});

// ─────────────────────── THE CERT + PHI/REI GATE (key invariant) ────────────

describe("P2-S12 — log_spray CERTIFICATION gate (fail-closed, the slice's keystone)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("RAISES for an applicator with NO valid cert — and writes NO spray row", async () => {
    // w-06 has no cert at all.
    await expect(
      h.query(sql(`select log_spray(
        'p-cuesta-piedra', 'Verdadero 600', 'imidacloprid', 14, 24, now(), 'w-06',
        'dev', 1, 'spray-nocert'
      );`)),
    ).rejects.toThrow(/spray gate|certification|cert/i);

    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-nocert';`),
    );
    expect(rows[0].n).toBe(0); // fail-closed: nothing written
  });

  it("RAISES for an applicator whose cert is EXPIRED (validity comes from v_worker_certs_valid)", async () => {
    await grantCert(h, "w-06", "2025-06-01"); // expired before today (2026-06-21)
    await expect(
      h.query(sql(`select log_spray(
        'p-cuesta-piedra', 'Verdadero 600', 'imidacloprid', 14, 24, now(), 'w-06', 'dev', 2, 'spray-expired'
      );`)),
    ).rejects.toThrow(/spray gate|certification|cert/i);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-expired';`),
    );
    expect(rows[0].n).toBe(0);
  });

  it("SUCCEEDS for an applicator with a VALID cert, and stamps the PHI window", async () => {
    await grantCert(h, "w-agro", "2027-12-31"); // valid through next year
    // applied just now — the applied_at clamp (no backdating/future) requires a
    // recent honest timestamp; a fixed wall-clock date would drift past the clamp.
    const id = await h.query<{ log_spray: number }>(
      sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        now() - interval '1 hour', 'w-agro', 'dev', 3, 'spray-valid'
      ) as log_spray;`),
    );
    expect(Number(id[0].log_spray)).toBeGreaterThan(0);

    const row = await h.query<{ phi_clears_on: string; worker_id: string; expected: string }>(
      sql(`select to_char(phi_clears_on,'YYYY-MM-DD')                                  as phi_clears_on,
                  worker_id,
                  to_char(((now() - interval '1 hour') + interval '14 days')::date,'YYYY-MM-DD') as expected
           from spray_application where idempotency_key = 'spray-valid';`),
    );
    expect(row[0].worker_id).toBe("w-agro");
    // applied now + 14 PHI days → the stamped phi_clears_on
    expect(row[0].phi_clears_on).toBe(row[0].expected);
  });

  it("the PHI window surfaces on v_plot_phi_status as active (blocks a pick) and on the planner", async () => {
    const phi = await h.query<{ phi_active: boolean; plot_id: string }>(
      sql(`select phi_active, plot_id from v_plot_phi_status where plot_id = 'p-talamanca';`),
    );
    expect(phi.length).toBe(1);
    expect(phi[0].phi_active).toBe(true);
  });

  it("is exactly-once — a valid spray replay returns the same id and writes one row", async () => {
    // Same idempotency_key 'spray-valid' as the prior test — the replay guard short-
    // circuits BEFORE the applied_at clamp, so a later (still-recent) timestamp here
    // returns the original id without re-validating or inserting a second row.
    const again = await h.query<{ log_spray: number }>(
      sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        now() - interval '1 hour', 'w-agro', 'dev', 3, 'spray-valid'
      ) as log_spray;`),
    );
    expect(Number(again[0].log_spray)).toBeGreaterThan(0);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-valid';`),
    );
    expect(rows[0].n).toBe(1);
  });

  it("the spray log is append-only (UPDATE blocked)", async () => {
    await expect(
      h.query(sql(`update spray_application set product = 'tampered' where idempotency_key = 'spray-valid';`)),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("anon cannot execute log_spray", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(sql(`select log_spray('p-cuesta-piedra','x',null,0,0,now(),'w-agro','evil',1,'spray-evil');`)),
      ),
    ).rejects.toThrow(/permission denied|denied/i);
  });
});

describe("P2-S12 — log_spray PHI/REI gate (re-entry conflict, fail-closed)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await grantCert(h, "w-agro", "2027-12-31");
    // first spray: a 48-hour REI window opening now.
    await h.query(sql(`select log_spray(
      'p-cuesta-piedra', 'Product A', 'ai-a', 7, 48, now(), 'w-agro', 'dev', 1, 'rei-first'
    );`));
  });
  afterAll(async () => h.close());

  it("RAISES a re-entry conflict for a second spray inside the still-open REI window", async () => {
    await expect(
      h.query(sql(`select log_spray(
        'p-cuesta-piedra', 'Product B', 'ai-b', 7, 24, now() + interval '1 hour', 'w-agro', 'dev', 2, 'rei-conflict'
      );`)),
    ).rejects.toThrow(/spray gate|re-entry|REI/i);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'rei-conflict';`),
    );
    expect(rows[0].n).toBe(0); // fail-closed
  });
});

// ─────────────── log_spray applied_at clamp (the PHI-bypass keystone) ────────
// The load-bearing S12 compliance invariant: a spray cannot be logged with a
// backdated/forged applied_at that fakes a clear PHI/REI window. The entire safety
// window (phi_clears_on / rei_clears_at) is derived from applied_at, and
// v_plot_phi_status.phi_active is exactly (phi_clears_on >= current_date), so a
// client-controlled applied_at pushed into the past makes a freshly-sprayed plot
// look PHI-clear while the chemical is still toxic. The DB write door must clamp it.
describe("P2-S12 — log_spray clamps applied_at (no backdated/future PHI bypass)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await grantCert(h, "w-agro", "2027-12-31");
  });
  afterAll(async () => h.close());

  it("RAISES for a materially BACKDATED applied_at (PHI window cannot be faked clear)", async () => {
    // Spray imidacloprid (PHI 14d) physically TODAY, but logged 15 days in the past.
    // Pre-fix: phi_clears_on = today-1 → phi_active=false the instant it lands.
    await expect(
      h.query(sql(`select log_spray(
        'p-las-lagunas', 'Verdadero 600', 'imidacloprid', 14, 24,
        now() - interval '15 days', 'w-agro', 'dev', 10, 'spray-backdated'
      );`)),
    ).rejects.toThrow(/spray gate|applied_at|past/i);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-backdated';`),
    );
    expect(rows[0].n).toBe(0); // fail-closed: nothing written
  });

  it("when an honest spray IS logged, its PHI window stays active (no bypass remains)", async () => {
    // A spray applied now with PHI 14d MUST leave the plot PHI-active.
    await h.query(sql(`select log_spray(
      'p-las-lagunas', 'Verdadero 600', 'imidacloprid', 14, 24,
      now(), 'w-agro', 'dev', 11, 'spray-honest'
    );`));
    const phi = await h.query<{ phi_active: boolean }>(
      sql(`select phi_active from v_plot_phi_status where plot_id = 'p-las-lagunas';`),
    );
    expect(phi[0].phi_active).toBe(true);
  });

  it("RAISES for a FUTURE applied_at beyond the clock-skew tolerance", async () => {
    await expect(
      h.query(sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        '2027-01-01T00:00:00Z', 'w-agro', 'dev', 12, 'spray-future'
      );`)),
    ).rejects.toThrow(/spray gate|applied_at|future/i);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-future';`),
    );
    expect(rows[0].n).toBe(0);
  });

  it("RAISES for a NULL applied_at with a clean message", async () => {
    await expect(
      h.query(sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        null, 'w-agro', 'dev', 13, 'spray-nullapplied'
      );`)),
    ).rejects.toThrow(/spray gate|applied_at|required/i);
  });
});

// ─────────────── v_worker_certs_valid lower bound (future cert) ──────────────
// A cert whose issued_at is in the FUTURE must NOT be valid today — otherwise an
// untrained applicator with a not-yet-effective pesticide-handling cert passes the
// fail-closed GATE 1. The view (the single source GATE 1 trusts) must bound issued_at.
describe("P2-S12 — a FUTURE-issued cert is NOT valid today (spray gate stays closed)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("a future-issued pesticide-handling cert does NOT appear in v_worker_certs_valid", async () => {
    await h.query(sql(`
      insert into worker_certifications (worker_id, cert_kind, issued_at, expires_at, issuer)
      values ('w-06', 'pesticide-handling', '2027-01-01', '2030-01-01', 'MIDA Panamá');
    `));
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from v_worker_certs_valid
           where worker_id = 'w-06' and cert_kind = 'pesticide-handling';`),
    );
    expect(rows[0].n).toBe(0);
  });

  it("log_spray RAISES for a worker holding ONLY a future-issued cert", async () => {
    await expect(
      h.query(sql(`select log_spray(
        'p-cuesta-piedra', 'Verdadero 600', 'imidacloprid', 14, 24, now(), 'w-06',
        'dev', 20, 'spray-futurecert'
      );`)),
    ).rejects.toThrow(/spray gate|certification|cert/i);
    const rows = await h.query<{ n: number }>(
      sql(`select count(*)::int as n from spray_application where idempotency_key = 'spray-futurecert';`),
    );
    expect(rows[0].n).toBe(0);
  });
});

// ─────────────── v_plot_phi_status must not mask a newer spray's REI ─────────
// distinct-on max(phi_clears_on) returns ONE row per plot — the spray with the
// longest PHI. When an OLD long-PHI spray (REI long cleared) coexists with a NEWER
// short-PHI spray whose REI is still OPEN, the old row wins and rei_active is read
// off the wrong spray → the live re-entry hazard is hidden. Aggregate over all sprays.
describe("P2-S12 — v_plot_phi_status surfaces ANY still-active REI (no max-PHI masking)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await grantCert(h, "w-agro", "2027-12-31");
    // OLD spray: huge PHI (365d), tiny REI (1h) → REI long cleared, but it wins
    // distinct-on max(phi_clears_on). Insert directly (append-only ledger) so we can
    // place it in the past without tripping the new applied_at clamp on log_spray.
    await h.query(sql(`
      insert into spray_application (plot_id, product, active_ingredient, phi_days, rei_hours,
                                     applied_at, phi_clears_on, rei_clears_at, worker_id,
                                     device_id, device_seq, idempotency_key)
      values ('p-talamanca', 'OldProd', 'ai-old', 365, 1,
              now() - interval '30 days',
              (now() - interval '30 days' + interval '365 days')::date,
              now() - interval '30 days' + interval '1 hour',
              'w-agro', 'seed', 100, 'phi-old');
    `));
    // NEW spray today: short PHI (1d), long REI (240h ≈ 10 days, still OPEN).
    await h.query(sql(`select log_spray(
      'p-talamanca', 'NewProd', 'ai-new', 1, 240, now(), 'w-agro', 'dev', 101, 'phi-new'
    );`));
  });
  afterAll(async () => h.close());

  it("reports rei_active=true because the NEWER spray's REI is still open", async () => {
    const phi = await h.query<{ rei_active: boolean; phi_active: boolean }>(
      sql(`select rei_active, phi_active from v_plot_phi_status where plot_id = 'p-talamanca';`),
    );
    expect(phi.length).toBe(1);
    expect(phi[0].rei_active).toBe(true); // pre-fix: false (read off the OLD max-PHI row)
  });
});

// ─────────────── NULL idempotency-key guard (exactly-once cannot be bypassed) ─
// idempotency_key is a nullable UNIQUE column; the replay guard is `where
// idempotency_key = p_idempotency_key`, which is UNKNOWN for NULL (never matches),
// and a NULL never conflicts in a UNIQUE index — so every NULL-key call inserts a
// fresh row (and record_scouting fires a fresh control task). Mirror the sibling
// harvest-planner guard: a NULL/blank key is rejected.
describe("P2-S12 — NULL idempotency_key is rejected (no exactly-once bypass)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
    await grantCert(h, "w-agro", "2027-12-31");
  });
  afterAll(async () => h.close());

  it("record_scouting RAISES on a NULL key and fires NO task / writes NO row", async () => {
    const tasksBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    const obsBefore = await h.query<{ n: number }>(sql(`select count(*)::int as n from scouting_observation;`));
    await expect(
      h.query(sql(`select record_scouting(
        'p-cuesta-piedra', 'broca', 8, 'borings', 'w-agro', now(), 'scout', 1, null
      );`)),
    ).rejects.toThrow(/idempotency_key is required/i);
    const tasksAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from tasks;`));
    const obsAfter = await h.query<{ n: number }>(sql(`select count(*)::int as n from scouting_observation;`));
    expect(tasksAfter[0].n).toBe(tasksBefore[0].n);
    expect(obsAfter[0].n).toBe(obsBefore[0].n);
  });

  it("record_scouting RAISES on a blank key", async () => {
    await expect(
      h.query(sql(`select record_scouting(
        'p-cuesta-piedra', 'broca', 8, 'borings', 'w-agro', now(), 'scout', 2, '   '
      );`)),
    ).rejects.toThrow(/idempotency_key is required/i);
  });

  it("log_spray RAISES on a NULL key and writes NO spray row", async () => {
    const before = await h.query<{ n: number }>(sql(`select count(*)::int as n from spray_application;`));
    await expect(
      h.query(sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24, now(), 'w-agro', 'dev', 5, null
      );`)),
    ).rejects.toThrow(/idempotency_key is required/i);
    const after = await h.query<{ n: number }>(sql(`select count(*)::int as n from spray_application;`));
    expect(after[0].n).toBe(before[0].n);
  });

  it("log_spray RAISES on a blank key", async () => {
    await expect(
      h.query(sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24, now(), 'w-agro', 'dev', 6, ''
      );`)),
    ).rejects.toThrow(/idempotency_key is required/i);
  });
});

// ─────────────────────────── AD-8 grant posture ────────────────────────────

describe("P2-S12 — AD-8 grant posture (the carried cross-slice rail)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedFixtures(h);
  });
  afterAll(async () => h.close());

  it("authenticated can SELECT the new tables/views; anon cannot", async () => {
    for (const rel of [
      "plot_vegetation_index",
      "scouting_observation",
      "spray_application",
      "v_plot_vegetation",
      "v_ipm_threshold",
      "v_plot_phi_status",
      "v_spray_history",
    ]) {
      const ok = await h.query<{ n: number }>(`select count(*)::int as n from ${rel};`);
      expect(ok[0].n).toBeGreaterThanOrEqual(0);
      await expect(
        asAnon(h, (hh) => hh.query(`select * from ${rel} limit 1;`)),
      ).rejects.toThrow(/permission denied|denied/i);
    }
  });

  it("no role holds INSERT/UPDATE/DELETE on the new tables (writes go via the RPCs only)", async () => {
    const grants = await h.query<{ privilege_type: string }>(
      sql(`select privilege_type
           from information_schema.role_table_grants
           where table_name in ('plot_vegetation_index','scouting_observation','spray_application')
             and grantee in ('anon','authenticated')
             and privilege_type in ('INSERT','UPDATE','DELETE');`),
    );
    expect(grants).toEqual([]);
  });
});
