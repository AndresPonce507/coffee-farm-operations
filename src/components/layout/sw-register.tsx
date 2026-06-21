"use client";

import { useEffect } from "react";

import { offlineFlagEnabled } from "@/lib/offline/flag";

/**
 * ServiceWorkerRegistrar (P2-S0) — a render-null client island that registers
 * the hand-rolled Service Worker once on mount. Mounted in the app shell.
 *
 * Graceful degradation: it registers ONLY when the offline flag is on AND the
 * platform exposes `navigator.serviceWorker`. With neither it is a silent no-op,
 * so online-only behaves exactly as before. On finding an updated SW it triggers
 * `SKIP_WAITING` so the new shell takes over promptly (the deploy cache-bust).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!offlineFlagEnabled()) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled || !reg) return;
        // When a new SW is found, ask it to activate immediately so a fresh
        // build's shell replaces the cached one without a manual reload.
        reg.addEventListener?.("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener?.("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage?.("SKIP_WAITING");
            }
          });
        });
      })
      .catch(() => {
        // A registration failure must never break the app — offline is an
        // enhancement. Swallow (the page works online regardless).
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
