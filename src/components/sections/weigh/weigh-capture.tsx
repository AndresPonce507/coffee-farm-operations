"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, MapPin, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uuidv7 } from "@/lib/offline/uuidv7";
import { getEnqueueCommand } from "@/lib/offline/runtime";
import { readWeightKg } from "@/lib/ble/scale";
import {
  validateWeighIn,
  weighInRpcArgs,
  type ScaleSource,
} from "@/lib/db/commands/recordWeighIn";

import { PickerGrid, type PickerOption } from "./picker-grid";
import { WeighNumericPad } from "./weigh-numeric-pad";
import { RipenessPad, type RipenessValue } from "./ripeness-pad";
import { WeighTally } from "./weigh-tally";

/**
 * WeighCapture — the <3-second, glove-friendly, OFFLINE-FIRST genesis capture surface
 * (P2-S2). The single most-used screen on the farm. The flow, top to bottom:
 *   (1) badge the picker (tap a glass crew card),
 *   (2) confirm the plot (auto-selected from GPS when a fix lands; a chip to change),
 *   (3) enter kg (the giant numeric pad — manual is always available; a BLE scale is
 *       an optional upgrade behind the scale port),
 *   (4) one ripeness tap,
 *   then CAPTURE — which writes through S0's enqueueCommand so it is durable offline
 *   and replayed exactly-once on reconnect (the idempotency_key the RPC dedupes on).
 *
 * Resilience: it prefers the offline runtime (`getEnqueueCommand`) so a tap NEVER
 * blocks on signal; if a server `action` is supplied (online-only fallback / tests)
 * and the offline path is unavailable, it uses that. After a capture it shows a calm
 * "captured" confirmation, bumps the local tally optimistically, and resets for the
 * next lata — never re-keying anything.
 *
 * Glass discipline: GPU transforms only, reduced-motion-safe, AA-on-glass, big touch
 * targets; confirmation conveyed by icon + text, not colour alone.
 */

/** The minimal device-clock + id seam (injected in tests for determinism). */
export interface WeighCaptureDeps {
  /** Mint the exactly-once key (defaults to uuidv7). */
  mintKey?: () => string;
  /** Now, ISO (defaults to new Date().toISOString()). */
  now?: () => string;
  /** Resolve a device id (defaults to a per-mount ephemeral id; real id from S0). */
  deviceId?: string;
  /** Acquire a GPS fix (defaults to navigator.geolocation). Returns null on failure. */
  getPosition?: () => Promise<{ lat: number; lng: number } | null>;
  /** Pair + read a BLE scale (defaults to the real port). */
  readScale?: typeof readWeightKg;
  /**
   * The write seam. Defaults to the S0 offline runtime. A test (or an online-only
   * fallback) can inject a function that returns the outcome shape below.
   */
  submit?: (cmd: {
    rpc: "record_weigh_in";
    args: Record<string, unknown>;
    occurredAt: string;
    deviceId: string;
    idempotencyKey: string;
  }) => Promise<{ outcome: "queued" | "sent" | "rejected" | "error"; message?: string }>;
}

export interface WeighCaptureProps {
  pickers: PickerOption[];
  plots: { id: string; name: string; lat?: number | null; lng?: number | null }[];
  farmKgToday: number;
  deps?: WeighCaptureDeps;
  className?: string;
}

type Phase = "idle" | "saving" | "captured" | "error";

/** Haversine metres — to auto-pick the nearest plot from a GPS fix. */
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function WeighCapture({
  pickers,
  plots,
  farmKgToday,
  deps = {},
  className,
}: WeighCaptureProps) {
  const mintKey = deps.mintKey ?? uuidv7;
  const now = deps.now ?? (() => new Date().toISOString());
  const readScale = deps.readScale ?? readWeightKg;

  const [pickerId, setPickerId] = useState<string | null>(null);
  const [plotId, setPlotId] = useState<string | null>(plots[0]?.id ?? null);
  const [kg, setKg] = useState("");
  const [ripeness, setRipeness] = useState<RipenessValue | null>(null);
  const [source, setSource] = useState<ScaleSource>("manual");
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [scaleBusy, setScaleBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  // Optimistic local tally bumps so the scoreboard climbs even fully offline.
  const [localBumps, setLocalBumps] = useState<Record<string, { kg: number; latas: number }>>(
    {},
  );
  const [localFarmKg, setLocalFarmKg] = useState(0);

  const deviceIdRef = useRef(deps.deviceId ?? `weigh-${mintKey()}`);

  const selectedPicker = useMemo(
    () => pickers.find((p) => p.workerId === pickerId) ?? null,
    [pickers, pickerId],
  );
  const selectedPlot = useMemo(
    () => plots.find((p) => p.id === plotId) ?? null,
    [plots, plotId],
  );

  const pickerKgToday =
    (selectedPicker?.kgToday ?? 0) + (pickerId ? (localBumps[pickerId]?.kg ?? 0) : 0);
  const pickerLatas = pickerId ? (localBumps[pickerId]?.latas ?? 0) : 0;

  // GPS: auto-pick the nearest plot to the fix (a confirm chip, never a hard lock).
  // The fix can take up to 6 s at a signal-poor 1,700 masl site, so the button
  // reports busy (spinner + disabled) and a failure surfaces a calm inline message
  // — never a silent up-to-6 s hang, never silent failure (mirrors the scale path).
  const acquireGps = useCallback(async () => {
    if (gpsBusy) return; // guard concurrent getCurrentPosition on repeated taps.
    const getPos =
      deps.getPosition ??
      (async () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) return null;
        return new Promise<{ lat: number; lng: number } | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
          );
        });
      });
    setGpsBusy(true);
    try {
      const pos = await getPos();
      if (!pos) {
        // Permission denied / timeout: tell the picker so they confirm by hand —
        // the plot <select> always works, so this is informative, never blocking.
        setError("No se pudo ubicar con GPS — confirma la parcela a mano.");
        return;
      }
      setFix(pos);
      // nearest plot with coordinates wins the auto-select.
      let best: { id: string; d: number } | null = null;
      for (const p of plots) {
        if (p.lat == null || p.lng == null) continue;
        const d = distM(pos.lat, pos.lng, p.lat, p.lng);
        if (!best || d < best.d) best = { id: p.id, d };
      }
      if (best) setPlotId(best.id);
    } finally {
      setGpsBusy(false);
    }
  }, [deps, plots, gpsBusy]);

  const tryScale = useCallback(async () => {
    setScaleBusy(true);
    try {
      const r = await readScale();
      if (r.ok) {
        setKg(r.reading.kg.toFixed(1));
        setSource("ble");
      } else if (r.reason === "error") {
        setError("Scale didn’t connect — enter the weight by hand.");
      }
      // unsupported / cancelled: silently fall back to the pad (no scary error).
    } finally {
      setScaleBusy(false);
    }
  }, [readScale]);

  const kgNum = Number(kg);
  const ready =
    !!pickerId && !!plotId && !!ripeness && Number.isFinite(kgNum) && kgNum > 0;

  const reset = useCallback(() => {
    setKg("");
    setRipeness(null);
    setSource("manual");
    setPhase("idle");
    setError(null);
  }, []);

  const capture = useCallback(async () => {
    if (!ready || !pickerId || !plotId || !ripeness) return;
    setPhase("saving");
    setError(null);

    const parsed = validateWeighIn({
      workerId: pickerId,
      plotId,
      cherriesKg: kg,
      ripeness,
      scaleSource: source,
      capturedLat: fix?.lat ?? "",
      capturedLng: fix?.lng ?? "",
      occurredAt: now(),
      deviceId: deviceIdRef.current,
      // A PLACEHOLDER only: the client cannot mint the durable per-device counter.
      // The outbox stamps a monotonic `device_seq` at enqueue, and the transport
      // injects it into `args.p_device_seq` before the RPC — so this 0 never reaches
      // the DB (it would otherwise collide on `unique (device_id, device_seq)`).
      deviceSeq: "0",
      idempotencyKey: mintKey(),
    });
    if (!parsed.ok) {
      setPhase("error");
      setError(Object.values(parsed.errors)[0] ?? "Check the entry.");
      return;
    }

    const submit =
      deps.submit ??
      (async (cmd) => {
        const enqueue = getEnqueueCommand();
        return enqueue(cmd);
      });

    try {
      const res = await submit({
        rpc: "record_weigh_in",
        args: weighInRpcArgs(parsed.data),
        occurredAt: parsed.data.occurredAt,
        deviceId: parsed.data.deviceId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (res.outcome === "rejected" || res.outcome === "error") {
        setPhase("error");
        setError(res.message ?? "Could not save this weigh-in.");
        return;
      }
      // queued (offline-safe) or sent — both are a success for the picker.
      setLocalBumps((b) => ({
        [pickerId]: {
          kg: (b[pickerId]?.kg ?? 0) + kgNum,
          latas: (b[pickerId]?.latas ?? 0) + 1,
        },
        ...Object.fromEntries(Object.entries(b).filter(([k]) => k !== pickerId)),
      }));
      setLocalFarmKg((f) => f + kgNum);
      setPhase("captured");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Could not save this weigh-in.");
    }
  }, [ready, pickerId, plotId, ripeness, kg, source, fix, now, mintKey, deps, kgNum]);

  return (
    <div className={cn("space-y-5", className)}>
      <WeighTally
        pickerName={selectedPicker?.name ?? null}
        pickerKgToday={pickerKgToday}
        pickerLatas={pickerLatas}
        farmKgToday={farmKgToday + localFarmKg}
      />

      {/* (1) badge the picker */}
      <section aria-labelledby="weigh-picker-h" className="space-y-2.5">
        <h2 id="weigh-picker-h" className="text-sm font-semibold text-ink">
          1 · Badge the picker
        </h2>
        <PickerGrid pickers={pickers} selectedId={pickerId} onSelect={setPickerId} />
      </section>

      {/* (2) confirm the plot */}
      <section aria-labelledby="weigh-plot-h" className="space-y-2.5">
        <h2 id="weigh-plot-h" className="text-sm font-semibold text-ink">
          2 · Confirm the plot
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="weigh-plot-select">
            Plot
          </label>
          <select
            id="weigh-plot-select"
            value={plotId ?? ""}
            onChange={(e) => setPlotId(e.target.value)}
            className="glass-card min-h-[48px] rounded-xl border border-line px-4 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-100"
          >
            {plots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={acquireGps}
            disabled={gpsBusy}
            aria-busy={gpsBusy}
            className="inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-line bg-white/55 px-3.5 text-sm font-medium text-forest transition hover:bg-white/75 disabled:opacity-60"
          >
            {gpsBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4" aria-hidden="true" />
            )}
            {gpsBusy ? "Buscando GPS…" : fix ? "GPS set" : "Use GPS"}
          </button>
          {selectedPlot && (
            <span className="text-xs text-muted-fg">{selectedPlot.name}</span>
          )}
        </div>
      </section>

      {/* (3) weigh */}
      <section aria-labelledby="weigh-kg-h" className="space-y-2.5">
        <h2 id="weigh-kg-h" className="text-sm font-semibold text-ink">
          3 · Weigh the lata
        </h2>
        <WeighNumericPad
          value={kg}
          onChange={(v) => {
            setKg(v);
            setSource("manual");
          }}
          onTryScale={tryScale}
          scaleBusy={scaleBusy}
        />
      </section>

      {/* (4) ripeness */}
      <section aria-labelledby="weigh-ripe-h" className="space-y-2.5">
        <h2 id="weigh-ripe-h" className="text-sm font-semibold text-ink">
          4 · Ripeness
        </h2>
        <RipenessPad value={ripeness} onChange={setRipeness} />
      </section>

      {/* capture */}
      <div className="sticky bottom-3 z-10">
        {phase === "captured" ? (
          <div
            role="status"
            className="glass flex items-center justify-between gap-3 rounded-2xl px-5 py-4 ring-1 ring-forest-100 motion-safe:animate-rise"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-forest">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Weight captured — safe on this device
            </span>
            <Button type="button" variant="primary" onClick={reset}>
              Next lata
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            onClick={capture}
            disabled={!ready || phase === "saving"}
            className="h-14 w-full text-base"
            aria-label="Capture weigh-in"
          >
            {phase === "saving" ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            )}
            {phase === "saving" ? "Saving…" : "Capture"}
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-2 text-center text-sm text-cherry">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
