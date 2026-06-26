// P3-S18 — Direct-trade CRM: contacts + append-only relationship ledger + sample
// dispatches (the trust backbone). Replays the REAL migrations in PGlite (AD-9) and
// proves the slice's data-layer invariants against HAND-COMPUTED seeds — written RED
// first per the spec (docs/design/PHASE3-DESIGN.md lines 389–402 + §1 rails).
//
//   (1) MONEY GUARANTEE, ONE TERM WIDER — a sample dispatch is a THIRD oversell-guarded
//       claim alongside reservations + shipments. reserve 90 + sample 20 of a 100 kg lot
//       FAILS CLOSED; reserve 90 + sample 10 succeeds (atp = 0, never negative); the same
//       prevent_oversell trigger fires (no parallel counter). green_lots_atp.sampled_kg.
//   (2) grams→kg via convert_qty (never a hardcoded /1000); record_sample_dispatch is
//       idempotent (a replay draws no second claim).
//   (3) HELD-LOT GUARD — a lot under an open qc_hold is un-sampleable.
//   (4) event_set_hash EXTRACTION is byte-identical — the recreated lot_event_set_hash
//       still produces verifying lot chains (verify_chain stays green).
//   (5) CONTACT LEDGER — contact_events is append-only (update/delete throw) + hash-
//       chained + verify_chain('contact:<id>')-verifiable; consent flips append events;
//       consent kinds are refused by record_contact_event.
//   (6) consent integrity — upsert_contact rejects consent=true without a source.
//   (7) AD-8 GRANTS / posture — authenticated reads tables+views, holds no write grant;
//       anon reads/executes NOTHING; every RPC's EXECUTE is revoked from public.
//   (8) TENANT ISOLATION — a contact/dispatch in tenant A is invisible to tenant B.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot and materialize a green lot from it (default tenant). */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score: number },
) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'WH-A', now());`,
  );
}

/** Create a contact via the only writer; returns its id. */
async function seedContact(h: Harness, key: string, name = "Onyx Coffee Lab"): Promise<number> {
  const r = await h.query<{ id: number }>(
    `select upsert_contact(null, '${name}', 'roaster', 'prospect', 'US', 'buy@onyx.test',
        null, null, false, null, '${key}') as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. MONEY GUARANTEE — a sample dispatch is a third oversell-guarded claim term.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 oversell — sample_dispatches is the THIRD claim term", () => {
  let h: Harness;
  let contact: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-300", green: "JC-304", kg: 100, score: 88 });
    contact = await seedContact(h, "c-os");
    // reserve 90 kg first (the paid buyer's claim).
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-304', 'Paid Buyer', 90);`,
    );
  });
  afterAll(async () => h.close());

  it("a 20 kg sample on a lot with 90 kg already reserved is REJECTED (90+20 > 100)", async () => {
    await expect(
      h.query(
        `select record_sample_dispatch('JC-304', ${contact}, 20000, 'DHL', 'DHL-1', 'sd-over');`,
      ),
    ).rejects.toThrow(/oversell|exceed|available/i);
    // no orphan dispatch committed (the whole txn rolled back).
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from sample_dispatches where idempotency_key like '%sd-over';`,
    );
    expect(n[0].n).toBe(0);
  });

  it("a 10 kg sample brings the lot to exactly 100 kg committed — atp = 0, never negative", async () => {
    await h.query(
      `select record_sample_dispatch('JC-304', ${contact}, 10000, 'DHL', 'DHL-2', 'sd-ok');`,
    );
    const atp = await h.query<{ atp: number; sampled: number; reserved: number }>(
      `select atp, sampled_kg as sampled, reserved_kg as reserved
         from green_lots_atp where green_lot_code='JC-304';`,
    );
    expect(Number(atp[0].reserved)).toBeCloseTo(90, 6);
    expect(Number(atp[0].sampled)).toBeCloseTo(10, 6); // grams→kg = 10000/1000
    expect(Number(atp[0].atp)).toBeCloseTo(0, 6); // 100 − 90 − 0 − 10
  });

  it("any further claim past 100 kg is rejected by the same guard (atp can't go negative)", async () => {
    await expect(
      h.query(
        `select record_sample_dispatch('JC-304', ${contact}, 500, 'DHL', 'DHL-3', 'sd-extra');`,
      ),
    ).rejects.toThrow(/oversell|exceed|available/i);
  });

  it("record_sample_dispatch is idempotent — a replay draws no second claim", async () => {
    const a = await h.query<{ id: number }>(
      `select record_sample_dispatch('JC-304', ${contact}, 10000, 'DHL', 'DHL-2', 'sd-ok') as id;`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from sample_dispatches where idempotency_key like '%sd-ok';`,
    );
    expect(n[0].n).toBe(1); // the replay returned the same row
    expect(Number(a[0].id)).toBeGreaterThan(0);
  });

  it("lowering the green lot's mass below the committed total (incl. samples) is rejected", async () => {
    // 100 kg committed (90 reserved + 10 sampled); lowering to 50 must fail.
    await expect(
      h.query(`update lots set current_kg = 50 where code = 'JC-304' and tenant_id = current_tenant_id();`),
    ).rejects.toThrow(/oversell|committed|lower/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. HELD-LOT GUARD — a lot under an open qc_hold is un-sampleable.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 held-lot guard — a held lot cannot be sampled", () => {
  let h: Harness;
  let contact: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-310", green: "JC-314", kg: 100, score: 88 });
    contact = await seedContact(h, "c-hold");
    await h.query(
      `insert into qc_holds (green_lot_code, reason, placed_by, device_id, device_seq)
         values ('JC-314', 'cup-defect', 'qc', 'qc', 1);`,
    );
  });
  afterAll(async () => h.close());

  it("a sample dispatch against a held lot is rejected (qc-hold quarantine)", async () => {
    await expect(
      h.query(
        `select record_sample_dispatch('JC-314', ${contact}, 1000, 'UPS', 'UPS-1', 'sd-held');`,
      ),
    ).rejects.toThrow(/qc-hold|hold|reserved or shipped/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. event_set_hash extraction is byte-identical — lot chains still verify.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 event_set_hash extraction — lot_event chains stay verifiable", () => {
  let h: Harness;
  let lot: string;
  beforeAll(async () => {
    h = await freshDb();
    // mint a cherry lot + advance it: a real multi-event lot stream.
    await h.query(
      `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
         established_year, status, last_inspected, expected_yield_kg, harvested_kg)
         values ('p1', 1, 'Plot 1', 'B1', 'Geisha', 1, 1600, 800, 35, 2012, 'healthy',
                 '2026-01-01', 1500, 600);`,
    );
    await h.query(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
         values ('w1', 'Worker 1', 'Picker', 22, 'present', 2015, '+507 6500-0000', 0, 'Crew 1');`,
    );
    const r = await h.query<{ lot_code: string }>(
      `select (record_cherry_intake('p1','w1', 50, 'cherry-1'::text)).lot_code as lot_code;`,
    ).catch(async () => {
      // fall back to the full-arg intake signature if the 4-arg overload isn't present.
      const f = await h.query<{ code: string }>(
        `select record_cherry_intake('p1','w1', 50, 'Geisha'::coffee_variety, now(), 'd', 1, 'cherry-1b') as code;`,
      );
      return [{ lot_code: f[0].code }];
    });
    lot = r[0].lot_code;
  });
  afterAll(async () => h.close());

  it("the cherry-intake lot stream verifies under the recreated lot_event_set_hash", async () => {
    const r = await h.query<{ ok: boolean }>(`select verify_chain('${lot}') as ok;`);
    expect(r[0].ok).toBe(true);
  });

  it("a tampered lot_event payload makes verify_chain return false (detector still works)", async () => {
    // disable the immutability block, mutate a payload out of band, re-enable.
    await h.query(`alter table lot_event disable trigger lot_event_block_mutation;`);
    await h.query(
      `update lot_event set payload = payload || '{"tampered":true}'::jsonb
         where stream_key='${lot}';`,
    );
    await h.query(`alter table lot_event enable trigger lot_event_block_mutation;`);
    const r = await h.query<{ ok: boolean }>(`select verify_chain('${lot}') as ok;`);
    expect(r[0].ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. CONTACT LEDGER — append-only, hash-chained, consent flow.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 contact_events — append-only, hash-chained, verify_chain('contact:')", () => {
  let h: Harness;
  let contact: number;
  beforeAll(async () => {
    h = await freshDb();
    contact = await seedContact(h, "c-led");
    await h.query(
      `select record_contact_event(${contact}, 'inquiry', '{"channel":"email"}'::jsonb, 'ce-1');`,
    );
    await h.query(
      `select record_contact_event(${contact}, 'meeting', '{"where":"BoP"}'::jsonb, 'ce-2');`,
    );
  });
  afterAll(async () => h.close());

  it("the contact relationship chain verifies via verify_chain('contact:<id>')", async () => {
    const r = await h.query<{ ok: boolean }>(`select verify_chain('contact:${contact}') as ok;`);
    expect(r[0].ok).toBe(true);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from contact_events where contact_id = ${contact};`,
    );
    expect(n[0].n).toBeGreaterThanOrEqual(2);
  });

  it("contact_events is append-only — UPDATE and DELETE both throw", async () => {
    await expect(
      h.query(`update contact_events set kind='note' where contact_id = ${contact};`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from contact_events where contact_id = ${contact};`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("record_contact_event REFUSES consent kinds (consent flows only via upsert_contact)", async () => {
    await expect(
      h.query(`select record_contact_event(${contact}, 'consent_granted', '{}'::jsonb, 'ce-bad');`),
    ).rejects.toThrow(/consent events are written only via upsert_contact/i);
  });

  it("record_contact_event is idempotent — a replay returns the same event_uid", async () => {
    const a = await h.query<{ uid: string }>(
      `select record_contact_event(${contact}, 'note', '{"x":1}'::jsonb, 'ce-idem') as uid;`,
    );
    const b = await h.query<{ uid: string }>(
      `select record_contact_event(${contact}, 'note', '{"x":1}'::jsonb, 'ce-idem') as uid;`,
    );
    expect(a[0].uid).toBe(b[0].uid);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. CONSENT integrity + the directory derivation.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 consent integrity + v_contact_directory", () => {
  let h: Harness;
  let contact: number;
  beforeAll(async () => {
    h = await freshDb();
    contact = await seedContact(h, "c-consent");
  });
  afterAll(async () => h.close());

  it("upsert_contact REJECTS marketing consent=true with no consent_source (lawful basis)", async () => {
    await expect(
      h.query(
        `select upsert_contact(null, 'No Basis', 'roaster', 'lead', 'US', null, null, null,
            true, null, 'c-nobasis');`,
      ),
    ).rejects.toThrow(/consent.*source|lawful basis/i);
  });

  it("granting consent (with a source) appends a consent_granted event", async () => {
    await h.query(
      `select upsert_contact(${contact}, 'Onyx Coffee Lab', 'roaster', 'active', 'US',
          'buy@onyx.test', null, null, true, 'web-form', 'c-consent-grant');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from contact_events
         where contact_id = ${contact} and kind = 'consent_granted';`,
    );
    expect(n[0].n).toBe(1);
    const c = await h.query<{ consent: boolean; src: string }>(
      `select consent_marketing as consent, consent_source as src from contacts where id = ${contact};`,
    );
    expect(c[0].consent).toBe(true);
    expect(c[0].src).toBe("web-form");
  });

  it("withdrawing consent appends a consent_withdrawn event + stamps unsubscribed_at", async () => {
    await h.query(
      `select upsert_contact(${contact}, 'Onyx Coffee Lab', 'roaster', 'dormant', 'US',
          'buy@onyx.test', null, null, false, null, 'c-consent-withdraw');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from contact_events
         where contact_id = ${contact} and kind = 'consent_withdrawn';`,
    );
    expect(n[0].n).toBe(1);
    const c = await h.query<{ unsub: string | null }>(
      `select unsubscribed_at as unsub from contacts where id = ${contact};`,
    );
    expect(c[0].unsub).not.toBeNull();
  });

  it("v_contact_directory exposes the contact with a derived (0 here) lifetime_value_usd", async () => {
    const r = await h.query<{ name: string; ltv: number; events: number }>(
      `select name, lifetime_value_usd as ltv, event_count as events
         from v_contact_directory where contact_id = ${contact};`,
    );
    expect(r[0].name).toBe("Onyx Coffee Lab");
    expect(Number(r[0].ltv)).toBeCloseTo(0, 6); // no accepted quote bound to this contact
    expect(Number(r[0].events)).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. SAMPLE FEEDBACK + the dispatch pipeline view.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 record_sample_feedback + v_sample_dispatch_pipeline", () => {
  let h: Harness;
  let contact: number;
  let sampleId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-320", green: "JC-324", kg: 100, score: 90 });
    contact = await seedContact(h, "c-fb");
    const s = await h.query<{ id: number }>(
      `select record_sample_dispatch('JC-324', ${contact}, 2000, 'DHL', 'DHL-9', 'sd-fb') as id;`,
    );
    sampleId = Number(s[0].id);
  });
  afterAll(async () => h.close());

  it("a fresh dispatch shows on the pipeline with NULL latest_verdict", async () => {
    const rows = await h.query<{ sample_id: number; verdict: string | null; contact_name: string }>(
      `select sample_id, latest_verdict as verdict, contact_name
         from v_sample_dispatch_pipeline where sample_id = ${sampleId};`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].verdict).toBeNull();
    expect(rows[0].contact_name).toBe("Onyx Coffee Lab");
  });

  it("record_sample_feedback appends a sample_feedback event with the verdict", async () => {
    await h.query(
      `select record_sample_feedback(${sampleId}, 91, 'approved', 'loved it', 'sd-fb-verd');`,
    );
    const rows = await h.query<{ verdict: string | null }>(
      `select latest_verdict as verdict from v_sample_dispatch_pipeline where sample_id = ${sampleId};`,
    );
    expect(rows[0].verdict).toBe("approved");
  });

  it("rejects an invalid verdict word", async () => {
    await expect(
      h.query(`select record_sample_feedback(${sampleId}, 50, 'maybe', null, 'sd-fb-bad');`),
    ).rejects.toThrow(/invalid sample verdict/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. AD-8 GRANTS / append-only posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 AD-8 grants + posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("new tables grant NO insert/update/delete to authenticated or anon (RPC-only write)", async () => {
    for (const t of ["contacts", "contact_events", "sample_dispatches"]) {
      const r = await h.query<{ ai: boolean; au: boolean; ad: boolean; ani: boolean }>(
        `select has_table_privilege('authenticated','${t}','insert') as ai,
                has_table_privilege('authenticated','${t}','update') as au,
                has_table_privilege('authenticated','${t}','delete') as ad,
                has_table_privilege('anon','${t}','insert') as ani;`,
      );
      expect(r[0].ai, `${t} insert`).toBe(false);
      expect(r[0].au, `${t} update`).toBe(false);
      expect(r[0].ad, `${t} delete`).toBe(false);
      expect(r[0].ani, `${t} anon insert`).toBe(false);
    }
  });

  it("authenticated reads the tables+views; anon reads NONE", async () => {
    for (const t of [
      "contacts",
      "contact_events",
      "sample_dispatches",
      "v_contact_directory",
      "v_contact_timeline",
      "v_sample_dispatch_pipeline",
      "green_lots_atp",
    ]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as a,
                has_table_privilege('anon','${t}','select') as an;`,
      );
      expect(r[0].a, `authenticated reads ${t}`).toBe(true);
      expect(r[0].an, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("every command RPC is executable by authenticated, not anon, not public", async () => {
    const fns = [
      "upsert_contact(bigint, text, text, text, text, text, text, bigint, boolean, text, text)",
      "record_contact_event(bigint, text, jsonb, text)",
      "record_sample_dispatch(text, bigint, numeric, text, text, text)",
      "record_sample_feedback(bigint, numeric, text, text, text)",
    ];
    for (const fn of fns) {
      const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
        `select has_function_privilege('authenticated','${fn}','execute') as a,
                has_function_privilege('anon','${fn}','execute') as an,
                has_function_privilege('public','${fn}','execute') as pub;`,
      );
      expect(r[0].a, `authenticated executes ${fn}`).toBe(true);
      expect(r[0].an, `anon must NOT execute ${fn}`).toBe(false);
      expect(r[0].pub, `public must NOT execute ${fn}`).toBe(false);
    }
  });

  it("the extracted event_set_hash + the internal append helper are NOT granted to anon/public", async () => {
    const r = await h.query<{ apub: boolean; aan: boolean; hpub: boolean }>(
      `select has_function_privilege('public','_append_contact_event(bigint, text, jsonb, text)','execute') as apub,
              has_function_privilege('anon','_append_contact_event(bigint, text, jsonb, text)','execute') as aan,
              has_function_privilege('public','event_set_hash(bytea, text, text, jsonb, timestamptz, text, bigint)','execute') as hpub;`,
    );
    expect(r[0].apub).toBe(false);
    expect(r[0].aan).toBe(false);
    expect(r[0].hpub).toBe(false);
  });

  it("anon cannot read contacts through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from contacts limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. TENANT ISOLATION — CRM data does not leak cross-tenant.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 tenant isolation — contacts/dispatches do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    await h.query(
      `insert into contacts (tenant_id, name, kind) values ('${A}','A Contact','roaster');`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, A's contact is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from contacts;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's contact is invisible", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from contacts where tenant_id = '${A}';`),
    );
    expect(rows).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 9. CROSS-TENANT IDEMPOTENCY KEY — record_sample_dispatch must tenant-qualify the
//    key it hands record_lot_event, or two tenants reusing the same client key collide
//    on lot_event's GLOBAL single-column unique and the second tenant's provenance
//    'sample_dispatched' event is silently dropped (regression for the raw-key bug).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S18 cross-tenant provenance — same client key, both lot chains get the event", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const SHARED_KEY = "sd-shared-xtenant"; // the SAME client idempotency string in both tenants
  let h: Harness;

  // Owner-seed (RLS-bypassing) a green lot + its backing `lots` row + a contact in a tenant.
  async function seedTenantLot(tenant: string, green: string): Promise<number> {
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('${tenant}', '${green}', 'green', 'Geisha', 100, 100, true, now());`,
    );
    await h.query(
      `insert into green_lots (tenant_id, lot_code, cupping_score, location, graded_at)
         values ('${tenant}', '${green}', 88, 'WH-A', now());`,
    );
    const r = await h.query<{ id: number }>(
      `insert into contacts (tenant_id, name, kind) values ('${tenant}','Shared Roaster','roaster')
         returning id as id;`,
    );
    return Number(r[0].id);
  }

  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    const contactA = await seedTenantLot(A, "JC-901");
    const contactB = await seedTenantLot(B, "JC-902");
    // Both tenants dispatch a sample reusing the SAME client idempotency key.
    await asTenant(h, A, (hh) =>
      hh.query(
        `select record_sample_dispatch('JC-901', ${contactA}, 1000, 'DHL', 'DHL-A', '${SHARED_KEY}');`,
      ),
    );
    await asTenant(h, B, (hh) =>
      hh.query(
        `select record_sample_dispatch('JC-902', ${contactB}, 1000, 'DHL', 'DHL-B', '${SHARED_KEY}');`,
      ),
    );
  });
  afterAll(async () => h.close());

  it("tenant A's green lot has its 'sample_dispatched' provenance event", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ c: number }>(
        `select count(*)::int as c from lot_event
           where stream_key = 'JC-901' and kind = 'sample_dispatched';`,
      ),
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it("tenant B's green lot ALSO has its 'sample_dispatched' event (not dropped by a key collision)", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query<{ c: number }>(
        `select count(*)::int as c from lot_event
           where stream_key = 'JC-902' and kind = 'sample_dispatched';`,
      ),
    );
    // FAILS on the raw-key code: B's insert collides with A's row on the global
    // unique(idempotency_key) and record_lot_event swallows it (returns null) → c = 0.
    expect(Number(rows[0].c)).toBe(1);
  });

  it("both lots' provenance chains still verify", async () => {
    const a = await asTenant(h, A, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('JC-901') as ok;`),
    );
    const b = await asTenant(h, B, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('JC-902') as ok;`),
    );
    expect(a[0].ok).toBe(true);
    expect(b[0].ok).toBe(true);
  });
});
