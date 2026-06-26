// P3-S17 — AR docs + payment settlement + the QBO/Xero/PAC sync seam.
//
// These tests replay the REAL migrations in PGlite (AD-9) and prove S17's keystone
// invariants against HAND-COMPUTED seeds — written RED first per the spec
// (PHASE3-DESIGN.md lines 369–388):
//
//   (1) AR CANNOT OVERSELL GREEN INVENTORY — issue_ar_doc commits each line's kg by
//       writing a lot_shipments row, so the EXISTING prevent_oversell trigger fires.
//       Invoicing 31 kg of a 30 kg lot fails closed (no parallel counter).
//   (2) THE INVOICE + ITS INVENTORY COMMITMENT ARE ONE ATOMIC ACT — a rejected line
//       rolls back the whole doc (no orphan ar_doc, no orphan revenue_entry).
//   (3) SYNC IS EXACTLY-ONCE — sync_outbox.idempotency_key (content-hash-derived) is
//       UNIQUE + ON CONFLICT DO NOTHING: re-issuing the same content enqueues once.
//   (4) issue_ar_doc enqueues one outbox row per target + appends the revenue journal
//       + the 'ar_issued' lot_event (hash-chained audit).
//   (5) THE FISCAL GATE — a dgi_pac (DGI factura) doc stays 'draft' until the PAC
//       round-trips a CUFE (mark_sync_result synced) — only then does it flip 'issued'.
//   (6) SETTLE → deterministic status + realized FX — settle_ar_payment drives the
//       S16 status trigger to 'paid' and books the two-rate fx_gain_loss_entry.
//   (7) NO ECHO LOOP — apply_sync_inbound applies an external payment via the SAME
//       settle path WITHOUT enqueuing an outbox row (the asymmetric source-of-truth
//       rule), and is idempotent on (target, external_id).
//   (8) APPEND-ONLY SEAM — sync_outbox rejects DELETE + rejects mutating its content
//       columns (only state/external_id/attempts/last_error move).
//   (9) AD-8/AD-9 GRANTS — authenticated reads every new table/view; anon reads/exec
//       NOTHING; every RPC's EXECUTE is revoked from public then granted authenticated.
//
// All money math is hand-computed in the comments next to each assertion.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot and materialize a green lot with declared mass. */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score?: number },
) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score ?? 88},'WH-A', now());`,
  );
}

/** A one-line invoice payload over a green lot. */
function lines(lot: string, kg: number, unit: number) {
  return JSON.stringify([
    { green_lot_code: lot, description: "Geisha green", kg, unit_price_doc: unit, amount_doc: kg * unit, source_kind: "green_sale" },
  ]).replace(/'/g, "''");
}

// ──────────────────────────────────────────────────────────────────────────
// 1. AR cannot oversell green inventory (the keystone money guarantee reused).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — AR cannot oversell green inventory", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 30 }); // 30 kg ATP
  });
  afterAll(async () => h.close());

  it("issues a valid 30 kg invoice and commits the inventory (ATP debits to 0)", async () => {
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 30, 10)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo'], 'issue-ok-1') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
    // a lot_shipments row was written → ATP fell from 30 to 0.
    const atp = await h.query<{ atp: number }>(
      `select atp from green_lots_atp where green_lot_code = 'JC-901';`,
    );
    expect(Number(atp[0].atp)).toBeCloseTo(0, 6);
  });

  it("REJECTS invoicing 31 kg of a 30 kg lot (prevent_oversell fails closed)", async () => {
    await seedGreen(h, { source: "JC-910", green: "JC-911", kg: 30 });
    await expect(
      h.query(
        `select issue_ar_doc('commercial_invoice','USD','${lines("JC-911", 31, 10)}'::jsonb,
                             'BUYER-1','CT-1','FOB', array['qbo'], 'issue-bad-1') as id;`,
      ),
    ).rejects.toThrow(/oversell|exceed|available/i);
  });

  it("the rejected invoice left NO orphan ar_doc or revenue_entry (one atomic act)", async () => {
    const docs = await h.query<{ n: number }>(
      `select count(*)::int as n from ar_doc where idempotency_key like '%issue-bad-1';`,
    );
    const rev = await h.query<{ n: number }>(
      `select count(*)::int as n from revenue_entry where green_lot_code = 'JC-911';`,
    );
    expect(docs[0].n).toBe(0);
    expect(rev[0].n).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. issue_ar_doc — journal + outbox + audit, and exactly-once sync.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — issue enqueues the journal, the outbox, and the audit event", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100 });
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 50, 12)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo','xero'], 'issue-2') as id;`,
    );
    docId = Number(r[0].id);
  });
  afterAll(async () => h.close());

  it("minted a gap-free doc with the right USD total (50 kg × $12 = $600)", async () => {
    const d = await h.query<{ doc_number: string; total_usd: number; status: string }>(
      `select doc_number, total_usd, status::text as status from ar_doc where id = ${docId};`,
    );
    expect(d[0].doc_number).toMatch(/^JC-CI-\d+$/);
    expect(Number(d[0].total_usd)).toBeCloseTo(600, 6);
    expect(d[0].status).toBe("issued"); // non-fiscal issues immediately
  });

  it("appended a revenue_entry for the lot ($600 USD)", async () => {
    const rev = await h.query<{ amount_usd: number }>(
      `select amount_usd from revenue_entry where ar_doc_id = ${docId};`,
    );
    expect(Number(rev[0].amount_usd)).toBeCloseTo(600, 6);
  });

  it("enqueued exactly ONE outbox row per target (qbo + xero)", async () => {
    const rows = await h.query<{ target: string }>(
      `select target::text as target from sync_outbox where ar_doc_id = ${docId}
        and entity_kind = 'ar_doc' order by target;`,
    );
    expect(rows.map((r) => r.target)).toEqual(["qbo", "xero"]);
  });

  it("appended the hash-chained 'ar_issued' lot_event", async () => {
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
        where stream_key = 'JC-901' and kind = 'ar_issued';`,
    );
    expect(ev[0].n).toBe(1);
  });

  it("re-issuing the SAME idempotency key returns the same doc (exactly-once)", async () => {
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 50, 12)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo','xero'], 'issue-2') as id;`,
    );
    expect(Number(r[0].id)).toBe(docId);
    // still only ONE outbox row per target — no double-post under retry.
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from sync_outbox where ar_doc_id = ${docId} and entity_kind = 'ar_doc';`,
    );
    expect(n[0].n).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. The fiscal gate — a DGI factura cannot claim 'issued' until the PAC stamps it.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — DGI fiscal gate (no issued status without the PAC CUFE)", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100 });
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 10, 10)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['dgi_pac'], 'issue-dgi') as id;`,
    );
    docId = Number(r[0].id);
  });
  afterAll(async () => h.close());

  it("a dgi_pac doc starts in 'draft' (NOT issued) — the PAC has not stamped it", async () => {
    const d = await h.query<{ status: string }>(
      `select status::text as status from ar_doc where id = ${docId};`,
    );
    expect(d[0].status).toBe("draft");
  });

  it("mark_sync_result(synced, CUFE) flips the doc to 'issued' (the PAC stamped it)", async () => {
    const ob = await h.query<{ id: number }>(
      `select id from sync_outbox where ar_doc_id = ${docId} and target = 'dgi_pac';`,
    );
    await h.query(
      `select mark_sync_result(${Number(ob[0].id)}, true, 'CUFE-FAKE-001', null);`,
    );
    const d = await h.query<{ status: string; ext: string }>(
      `select d.status::text as status, o.external_id as ext
         from ar_doc d join sync_outbox o on o.ar_doc_id = d.id and o.target = 'dgi_pac'
        where d.id = ${docId};`,
    );
    expect(d[0].status).toBe("issued");
    expect(d[0].ext).toBe("CUFE-FAKE-001");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Settle → deterministic status + realized two-rate FX.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — settle_ar_payment drives status + books realized FX", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100 });
    // EUR doc: record the on-book issue rate 1.10, then issue 100 € (= $110 at issue).
    await h.query(`select record_fx_rate('2026-07-01','EUR','USD',1.10,'manual','fx-issue');`);
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','EUR','${lines("JC-901", 10, 10)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo'], 'issue-eur') as id;`,
    );
    docId = Number(r[0].id);
  });
  afterAll(async () => h.close());

  it("a full payment at a stronger receipt rate flips status to 'paid' and books FX gain", async () => {
    // receipt rate 1.15 (euro strengthened): 100 € settles as $115. The realized FX
    // gain = amount_doc(100) × (1.15 − 1.10) = $5.00 booked to fx_gain_loss_entry.
    await h.query(`select record_fx_rate('2026-07-15','EUR','USD',1.15,'manual','fx-receipt');`);
    await h.query(
      `select settle_ar_payment(${docId}, 'wire', 100, 'EUR', 'pay-eur-1');`,
    );
    const d = await h.query<{ status: string }>(
      `select status::text as status from ar_doc where id = ${docId};`,
    );
    expect(d[0].status).toBe("paid");
    const fx = await h.query<{ gain: number }>(
      `select gain_usd as gain from fx_gain_loss_entry where ar_doc_id = ${docId};`,
    );
    expect(Number(fx[0].gain)).toBeCloseTo(5, 6); // 100 × (1.15 − 1.10)
  });

  it("settle enqueued a payment sync row to the doc's target (qbo)", async () => {
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from sync_outbox
        where ar_doc_id = ${docId} and entity_kind = 'ar_payment' and target = 'qbo';`,
    );
    expect(n[0].n).toBe(1);
  });

  it("REJECTS overpayment (the S16 cap trigger — a scarce invoice can't be double-collected)", async () => {
    await expect(
      h.query(`select settle_ar_payment(${docId}, 'wire', 50, 'EUR', 'pay-eur-2');`),
    ).rejects.toThrow(/overpay|exceed/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. No echo loop — inbound applies via the same path WITHOUT re-pushing.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — apply_sync_inbound applies without echoing back (asymmetric SoT)", () => {
  let h: Harness;
  let docId: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100 });
    const r = await h.query<{ id: number }>(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 50, 10)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo'], 'issue-inb') as id;`,
    );
    docId = Number(r[0].id);
  });
  afterAll(async () => h.close());

  it("an external QBO payment lands as an ar_payment but enqueues NO outbox row (no echo)", async () => {
    const before = await h.query<{ n: number }>(
      `select count(*)::int as n from sync_outbox where ar_doc_id = ${docId} and entity_kind = 'ar_payment';`,
    );
    await h.query(
      `select apply_sync_inbound('qbo','QBO-PAY-1','payment',
         jsonb_build_object('ar_doc_id', ${docId}, 'method','ach', 'amount_doc', 500, 'currency','USD'));`,
    );
    // the payment was applied (doc fully paid: 50×$10 = $500)
    const d = await h.query<{ status: string }>(
      `select status::text as status from ar_doc where id = ${docId};`,
    );
    expect(d[0].status).toBe("paid");
    // but NO new outbox payment row — we don't push a payment QBO already holds.
    const after = await h.query<{ n: number }>(
      `select count(*)::int as n from sync_outbox where ar_doc_id = ${docId} and entity_kind = 'ar_payment';`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("is idempotent on (target, external_id) — replaying the same pull is a no-op", async () => {
    const first = await h.query<{ id: number }>(
      `select apply_sync_inbound('qbo','QBO-PAY-1','payment',
         jsonb_build_object('ar_doc_id', ${docId}, 'method','ach', 'amount_doc', 500, 'currency','USD')) as id;`,
    );
    // same external id again → returns the same inbound row, books no second payment.
    const pays = await h.query<{ n: number }>(
      `select count(*)::int as n from ar_payment where ar_doc_id = ${docId};`,
    );
    expect(pays[0].n).toBe(1);
    expect(Number(first[0].id)).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. The sync seam is append-only (worker mutates only state/external_id/attempts).
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — sync_outbox append-only posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-900", green: "JC-901", kg: 100 });
    await h.query(
      `select issue_ar_doc('commercial_invoice','USD','${lines("JC-901", 10, 10)}'::jsonb,
                           'BUYER-1','CT-1','FOB', array['qbo'], 'issue-ap') as id;`,
    );
  });
  afterAll(async () => h.close());

  it("rejects a DELETE from sync_outbox", async () => {
    await expect(
      h.query(`delete from sync_outbox where entity_kind = 'ar_doc';`),
    ).rejects.toThrow();
  });

  it("rejects mutating an immutable column (payload) on sync_outbox", async () => {
    await expect(
      h.query(`update sync_outbox set payload = '{}'::jsonb where entity_kind = 'ar_doc';`),
    ).rejects.toThrow(/mutable|append-only/i);
  });

  it("claim_sync_batch claims pending rows (FOR UPDATE SKIP LOCKED) and marks them claimed", async () => {
    const claimed = await h.query<{ id: number; state: string }>(
      `select id, state::text as state from claim_sync_batch('qbo', 10);`,
    );
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed[0].state).toBe("claimed");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. AD-8/AD-9 grant posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S17 — AD-8/AD-9 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("authenticated holds SELECT on every new table/view; anon holds none", async () => {
    for (const obj of ["account_map", "sync_outbox", "sync_inbound", "v_sync_health", "v_cash_runway", "v_preharvest_finance"]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${obj}','select') as a,
                has_table_privilege('anon','${obj}','select') as an;`,
      );
      expect(r[0].a, `${obj} authenticated select`).toBe(true);
      expect(r[0].an, `${obj} anon select`).toBe(false);
    }
  });

  it("no role holds UPDATE/DELETE on the sync ledgers (writes go via the SECDEF RPCs)", async () => {
    for (const obj of ["sync_outbox", "sync_inbound"]) {
      const r = await h.query<{ u: boolean; d: boolean }>(
        `select has_table_privilege('authenticated','${obj}','update') as u,
                has_table_privilege('authenticated','${obj}','delete') as d;`,
      );
      expect(r[0].u, `${obj} update`).toBe(false);
      expect(r[0].d, `${obj} delete`).toBe(false);
    }
  });

  it("every S17 RPC is executable by authenticated, never anon", async () => {
    const sigs = [
      "issue_ar_doc(ar_doc_kind,text,jsonb,text,text,text,text[],text)",
      "settle_ar_payment(bigint,payment_method,numeric,text,text,boolean)",
      "void_ar_doc(bigint,text,text)",
      "claim_sync_batch(sync_target,integer)",
      "mark_sync_result(bigint,boolean,text,text)",
      "apply_sync_inbound(sync_target,text,text,jsonb)",
      "set_account_map(sync_target,text,text,text,text)",
    ];
    for (const s of sigs) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_function_privilege('authenticated','${s}','execute') as a,
                has_function_privilege('anon','${s}','execute') as an;`,
      );
      expect(r[0].a, `${s} authenticated`).toBe(true);
      expect(r[0].an, `${s} anon`).toBe(false);
    }
  });

  it("anon cannot read sync_outbox through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from sync_outbox limit 1;`)),
    ).rejects.toThrow();
  });
});
