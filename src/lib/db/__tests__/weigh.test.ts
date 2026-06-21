import { describe, expect, it } from "vitest";

import {
  mapWeighByLot,
  mapWeighByPicker,
  mapWeighByPlot,
  mapWeighEvent,
  mapWeighPlot,
  type WeighByLotRow,
  type WeighByPickerRow,
  type WeighByPlotRow,
  type WeighEventRow,
} from "@/lib/db/weigh";

/**
 * Direct coverage of the weigh read-port mappers (`src/lib/db/weigh.ts`) — the
 * P2-S2 per-picker weigh-capture read surface. These pure snake_case → camelCase
 * mappers carry the numeric coercion (kg/lata-count come back as strings from
 * PostgREST `count`/`sum`) and the nullable geofence/origin signals. The SQL of the
 * underlying views (v_weigh_today_by_picker / _by_plot / _by_lot /
 * v_lot_weigh_reconciliation) is pinned by the db-suite; this file pins the TS seam.
 */

describe("mapWeighByPicker", () => {
  it("coerces string aggregates to numbers and carries the crew + last-weigh", () => {
    const row: WeighByPickerRow = {
      worker_id: "w-06",
      name: "Lucía Morales",
      crew_id: "crew-tizingal",
      lata_count: "3",
      kg_today: "37.4",
      last_weigh_at: "2026-06-21T16:00:00Z",
    };
    expect(mapWeighByPicker(row)).toEqual({
      workerId: "w-06",
      name: "Lucía Morales",
      crewId: "crew-tizingal",
      lataCount: 3,
      kgToday: 37.4,
      lastWeighAt: "2026-06-21T16:00:00Z",
    });
  });

  it("tolerates a null crew + a picker with no weigh yet", () => {
    const row: WeighByPickerRow = {
      worker_id: "w-99",
      name: "New Picker",
      crew_id: null,
      lata_count: 0,
      kg_today: 0,
      last_weigh_at: null,
    };
    const m = mapWeighByPicker(row);
    expect(m.crewId).toBeNull();
    expect(m.kgToday).toBe(0);
    expect(m.lastWeighAt).toBeNull();
  });
});

describe("mapWeighByPlot", () => {
  it("carries the geofence aggregate signal (all_geofence_ok) through", () => {
    const row: WeighByPlotRow = {
      plot_id: "p-tizingal-alto",
      plot_name: "Tizingal Alto",
      lata_count: "5",
      kg_today: "62.1",
      all_geofence_ok: false,
    };
    expect(mapWeighByPlot(row)).toEqual({
      plotId: "p-tizingal-alto",
      plotName: "Tizingal Alto",
      lataCount: 5,
      kgToday: 62.1,
      allGeofenceOk: false,
    });
  });
});

describe("mapWeighByLot", () => {
  it("coerces weigh_kg + origin_kg and tolerates a null origin", () => {
    const a = mapWeighByLot({
      lot_code: "JC-712",
      lata_count: "4",
      weigh_kg: "48.0",
      origin_kg: "48.0",
    } satisfies WeighByLotRow);
    expect(a).toEqual({ lotCode: "JC-712", lataCount: 4, weighKg: 48, originKg: 48 });

    const b = mapWeighByLot({
      lot_code: "JC-713",
      lata_count: 1,
      weigh_kg: 9,
      origin_kg: null,
    } satisfies WeighByLotRow);
    expect(b.originKg).toBeNull();
  });
});

describe("mapWeighEvent", () => {
  it("coerces kg + nullable brix and carries the geofence signal", () => {
    const row: WeighEventRow = {
      event_uid: "e-1",
      worker_id: "w-06",
      crew_id: "crew-tizingal",
      plot_id: "p-tizingal-alto",
      lot_code: "JC-712",
      kg: "12.4",
      ripeness: "ripe",
      brix: null,
      scale_source: "manual",
      geofence_ok: true,
      occurred_at: "2026-06-21T15:00:00Z",
      recorded_at: "2026-06-21T15:00:02Z",
    };
    expect(mapWeighEvent(row)).toEqual({
      eventUid: "e-1",
      workerId: "w-06",
      crewId: "crew-tizingal",
      plotId: "p-tizingal-alto",
      lotCode: "JC-712",
      kg: 12.4,
      ripeness: "ripe",
      brix: null,
      scaleSource: "manual",
      geofenceOk: true,
      occurredAt: "2026-06-21T15:00:00Z",
      recordedAt: "2026-06-21T15:00:02Z",
    });
  });

  it("coerces a present brix probe reading", () => {
    const m = mapWeighEvent({
      event_uid: "e-2",
      worker_id: "w-06",
      crew_id: null,
      plot_id: "p-x",
      lot_code: "JC-1",
      kg: 5,
      ripeness: "overripe",
      brix: "21.5",
      scale_source: "ble",
      geofence_ok: null,
      occurred_at: "2026-06-21T15:00:00Z",
      recorded_at: "2026-06-21T15:00:00Z",
    });
    expect(m.brix).toBe(21.5);
    expect(m.geofenceOk).toBeNull();
    expect(m.scaleSource).toBe("ble");
  });
});

describe("mapWeighPlot", () => {
  it("derives lat/lng from the GeoJSON centroid ([lng, lat] → {lat, lng})", () => {
    expect(
      mapWeighPlot({
        id: "p-tizingal-alto",
        name: "Tizingal Alto",
        centroid: { coordinates: [-82.640344, 8.777835] },
      }),
    ).toEqual({
      id: "p-tizingal-alto",
      name: "Tizingal Alto",
      lat: 8.777835,
      lng: -82.640344,
    });
  });

  it("tolerates a plot with no centroid (lat/lng null — GPS auto-select skips it)", () => {
    const m = mapWeighPlot({ id: "p-x", name: "No Geom", centroid: null });
    expect(m.lat).toBeNull();
    expect(m.lng).toBeNull();
  });
});
