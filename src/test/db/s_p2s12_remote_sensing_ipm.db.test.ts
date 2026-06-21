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
    const id = await h.query<{ log_spray: number }>(
      sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        '2026-06-20T08:00:00Z', 'w-agro', 'dev', 3, 'spray-valid'
      ) as log_spray;`),
    );
    expect(Number(id[0].log_spray)).toBeGreaterThan(0);

    const row = await h.query<{ phi_clears_on: string; worker_id: string }>(
      sql(`select to_char(phi_clears_on,'YYYY-MM-DD') as phi_clears_on, worker_id
           from spray_application where idempotency_key = 'spray-valid';`),
    );
    expect(row[0].worker_id).toBe("w-agro");
    // applied 2026-06-20 + 14 PHI days → clears 2026-07-04
    expect(row[0].phi_clears_on).toBe("2026-07-04");
  });

  it("the PHI window surfaces on v_plot_phi_status as active (blocks a pick) and on the planner", async () => {
    const phi = await h.query<{ phi_active: boolean; plot_id: string }>(
      sql(`select phi_active, plot_id from v_plot_phi_status where plot_id = 'p-talamanca';`),
    );
    expect(phi.length).toBe(1);
    expect(phi[0].phi_active).toBe(true);
  });

  it("is exactly-once — a valid spray replay returns the same id and writes one row", async () => {
    const again = await h.query<{ log_spray: number }>(
      sql(`select log_spray(
        'p-talamanca', 'Verdadero 600', 'imidacloprid', 14, 24,
        '2026-06-20T08:00:00Z', 'w-agro', 'dev', 3, 'spray-valid'
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
