import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ContactDirectoryRow,
  ContactTimelineRow,
  SampleDispatchPipelineRow,
} from "@/lib/db/crm";

/**
 * Coverage of the `crm.ts` READ-port (P3-S18 — direct-trade CRM, the trust
 * backbone): the pure mappers (snake_case view row → camelCase domain, numeric
 * coercion of counts/value/score columns PostgREST may serialize as strings, NULL
 * preservation for an un-bound buyer / un-graded lot / awaited verdict) and the
 * `cache()`-wrapped getters' fetch + map round-trip:
 *
 *   - `getContactDirectory()`     reads `v_contact_directory`        (roster + DERIVED lifetime value).
 *   - `getContact(id)`            reads `v_contact_directory` filtered to one contact (null when absent).
 *   - `getContactTimeline(id)`    reads `v_contact_timeline`         (the append-only relationship ledger).
 *   - `getSampleDispatchPipeline()` reads `v_sample_dispatch_pipeline` (open dispatches + latest verdict).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so
 * `getSupabase()` returns a chainable, thenable query-builder. The CRM math (the
 * derived lifetime value, the latest-verdict lateral, the chain-verifiable
 * timeline) is the views' job (pinned by the migration's PGlite tests, not
 * re-implemented here); this port only proves the row→domain seam + NULL handling
 * survive `cache()` and hit the right view — NEVER the raw PII tables.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const directoryRow: ContactDirectoryRow = {
  contact_id: 7,
  name: "Onyx Coffee Lab",
  kind: "roaster",
  status: "active",
  country_code: "US",
  preferred_channel: "email",
  buyer_id: 3,
  buyer_name: "Onyx (B2B master)",
  consent_marketing: true,
  consent_source: "trade-show-2026",
  consent_at: "2026-06-20T10:00:00Z",
  unsubscribed_at: null,
  last_event_at: "2026-06-22T14:00:00Z",
  event_count: "4", // PostgREST may serialize a count as a string
  lifetime_value_usd: "12500.5",
};

const leadRow: ContactDirectoryRow = {
  contact_id: 9,
  name: "Curious Importer",
  kind: "importer",
  status: "lead",
  country_code: null,
  preferred_channel: null,
  buyer_id: null, // not yet bound to a b2b_buyers master
  buyer_name: null,
  consent_marketing: false,
  consent_source: null,
  consent_at: null,
  unsubscribed_at: null,
  last_event_at: null, // no events yet
  event_count: "0",
  lifetime_value_usd: "0",
};

const timelineRow: ContactTimelineRow = {
  contact_id: 7,
  event_uid: "11111111-1111-1111-1111-111111111111",
  stream_key: "contact:7",
  kind: "sample_sent",
  payload: { green_lot_code: "JC-701", grams: 250 },
  occurred_at: "2026-06-22T14:00:00Z",
  recorded_at: "2026-06-22T14:00:01Z",
  device_id: "server",
  device_seq: "42",
};

const pipelineRow: SampleDispatchPipelineRow = {
  sample_id: 5,
  green_lot_code: "JC-701",
  contact_id: 7,
  contact_name: "Onyx Coffee Lab",
  grams: "250",
  kg: "0.25",
  courier: "DHL",
  tracking_no: "DH-99",
  dispatched_at: "2026-06-22T14:00:00Z",
  sca_grade: "Presidential",
  cupping_score: "89.5",
  latest_verdict: null, // awaiting the buyer's cup
};

// ----- pure mapper: mapContactDirectoryEntry --------------------------------

describe("mapContactDirectoryEntry", () => {
  it("maps a v_contact_directory row with numeric coercion of count/value", async () => {
    const { mapContactDirectoryEntry } = await import("@/lib/db/crm");
    expect(mapContactDirectoryEntry(directoryRow)).toEqual({
      contactId: 7,
      name: "Onyx Coffee Lab",
      kind: "roaster",
      status: "active",
      countryCode: "US",
      preferredChannel: "email",
      buyerId: 3,
      buyerName: "Onyx (B2B master)",
      consentMarketing: true,
      consentSource: "trade-show-2026",
      consentAt: "2026-06-20T10:00:00Z",
      unsubscribedAt: null,
      lastEventAt: "2026-06-22T14:00:00Z",
      eventCount: 4,
      lifetimeValueUsd: 12500.5,
    });
  });

  it("preserves NULL buyer/consent/last-event fields for a fresh lead", async () => {
    const { mapContactDirectoryEntry } = await import("@/lib/db/crm");
    const e = mapContactDirectoryEntry(leadRow);
    expect(e.buyerId).toBeNull();
    expect(e.buyerName).toBeNull();
    expect(e.consentMarketing).toBe(false);
    expect(e.consentSource).toBeNull();
    expect(e.consentAt).toBeNull();
    expect(e.lastEventAt).toBeNull();
    expect(e.eventCount).toBe(0);
    expect(e.lifetimeValueUsd).toBe(0);
  });
});

// ----- pure mapper: mapContactTimelineEvent ---------------------------------

describe("mapContactTimelineEvent", () => {
  it("maps a v_contact_timeline row, coercing device_seq and passing payload through", async () => {
    const { mapContactTimelineEvent } = await import("@/lib/db/crm");
    expect(mapContactTimelineEvent(timelineRow)).toEqual({
      contactId: 7,
      eventUid: "11111111-1111-1111-1111-111111111111",
      streamKey: "contact:7",
      kind: "sample_sent",
      payload: { green_lot_code: "JC-701", grams: 250 },
      occurredAt: "2026-06-22T14:00:00Z",
      recordedAt: "2026-06-22T14:00:01Z",
      deviceId: "server",
      deviceSeq: 42,
    });
  });
});

// ----- pure mapper: mapSampleDispatchPipelineEntry --------------------------

describe("mapSampleDispatchPipelineEntry", () => {
  it("maps a v_sample_dispatch_pipeline row with numeric coercion of grams/kg/score", async () => {
    const { mapSampleDispatchPipelineEntry } = await import("@/lib/db/crm");
    expect(mapSampleDispatchPipelineEntry(pipelineRow)).toEqual({
      sampleId: 5,
      greenLotCode: "JC-701",
      contactId: 7,
      contactName: "Onyx Coffee Lab",
      grams: 250,
      kg: 0.25,
      courier: "DHL",
      trackingNo: "DH-99",
      dispatchedAt: "2026-06-22T14:00:00Z",
      scaGrade: "Presidential",
      cuppingScore: 89.5,
      latestVerdict: null,
    });
  });

  it("preserves a NULL courier/tracking/grade/score/verdict", async () => {
    const { mapSampleDispatchPipelineEntry } = await import("@/lib/db/crm");
    const e = mapSampleDispatchPipelineEntry({
      ...pipelineRow,
      courier: null,
      tracking_no: null,
      sca_grade: null,
      cupping_score: null,
      latest_verdict: null,
    });
    expect(e.courier).toBeNull();
    expect(e.trackingNo).toBeNull();
    expect(e.scaGrade).toBeNull();
    expect(e.cuppingScore).toBeNull();
    expect(e.latestVerdict).toBeNull();
  });

  it("maps a rendered verdict through unchanged", async () => {
    const { mapSampleDispatchPipelineEntry } = await import("@/lib/db/crm");
    const e = mapSampleDispatchPipelineEntry({
      ...pipelineRow,
      latest_verdict: "approved",
    });
    expect(e.latestVerdict).toBe("approved");
  });
});

// ----- getter: getContactDirectory ------------------------------------------

describe("getContactDirectory", () => {
  it("reads v_contact_directory and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_contact_directory: { data: [directoryRow, leadRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getContactDirectory } = await import("@/lib/db/crm");
    const roster = await getContactDirectory();

    expect(fromCalls).toContain("v_contact_directory");
    expect(roster).toHaveLength(2);
    expect(roster[0].name).toBe("Onyx Coffee Lab");
    expect(roster[0].lifetimeValueUsd).toBe(12500.5);
    expect(roster[1].buyerId).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_contact_directory: { data: null, error: { message: "roster boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getContactDirectory } = await import("@/lib/db/crm");
    await expect(getContactDirectory()).rejects.toThrow(
      "getContactDirectory: roster boom",
    );
  });
});

// ----- getter: getContact ----------------------------------------------------

describe("getContact", () => {
  it("reads v_contact_directory for one contact and returns the single entry", async () => {
    const { client, fromCalls } = makeClient({
      v_contact_directory: { data: [directoryRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getContact } = await import("@/lib/db/crm");
    const entry = await getContact(7);

    expect(fromCalls).toContain("v_contact_directory");
    expect(entry).not.toBeNull();
    expect(entry?.contactId).toBe(7);
    expect(entry?.kind).toBe("roaster");
  });

  it("returns null when the contact has no directory row", async () => {
    const { client } = makeClient({
      v_contact_directory: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getContact } = await import("@/lib/db/crm");
    expect(await getContact(404)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_contact_directory: { data: null, error: { message: "one boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getContact } = await import("@/lib/db/crm");
    await expect(getContact(7)).rejects.toThrow("getContact: one boom");
  });
});

// ----- getter: getContactTimeline -------------------------------------------

describe("getContactTimeline", () => {
  it("reads v_contact_timeline and returns camelCase events", async () => {
    const { client, fromCalls } = makeClient({
      v_contact_timeline: { data: [timelineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getContactTimeline } = await import("@/lib/db/crm");
    const events = await getContactTimeline(7);

    expect(fromCalls).toContain("v_contact_timeline");
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("sample_sent");
    expect(events[0].deviceSeq).toBe(42);
    expect(events[0].payload).toEqual({ green_lot_code: "JC-701", grams: 250 });
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_contact_timeline: { data: null, error: { message: "timeline boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getContactTimeline } = await import("@/lib/db/crm");
    await expect(getContactTimeline(7)).rejects.toThrow(
      "getContactTimeline: timeline boom",
    );
  });
});

// ----- getter: getSampleDispatchPipeline ------------------------------------

describe("getSampleDispatchPipeline", () => {
  it("reads v_sample_dispatch_pipeline and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_sample_dispatch_pipeline: { data: [pipelineRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getSampleDispatchPipeline } = await import("@/lib/db/crm");
    const pipeline = await getSampleDispatchPipeline();

    expect(fromCalls).toContain("v_sample_dispatch_pipeline");
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].greenLotCode).toBe("JC-701");
    expect(pipeline[0].kg).toBe(0.25);
    expect(pipeline[0].latestVerdict).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_sample_dispatch_pipeline: {
        data: null,
        error: { message: "pipeline boom" },
      },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getSampleDispatchPipeline } = await import("@/lib/db/crm");
    await expect(getSampleDispatchPipeline()).rejects.toThrow(
      "getSampleDispatchPipeline: pipeline boom",
    );
  });
});
