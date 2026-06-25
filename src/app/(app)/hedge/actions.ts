"use server";

import { reactiveRefresh } from "@/lib/revalidate";
import { getSupabase } from "@/lib/supabase/server";
import {
  lockFixation,
  type LockFixationStore,
} from "@/lib/db/commands/lockFixation";
import type {
  LockFixationInput,
  LockFixationResult,
} from "@/app/(app)/hedge/types";

/**
 * /hedge WRITE port — `lockFixationAction`: locks the "C" leg of ONE accepted,
 * un-fixed commodity reservation through the `lockFixation` command port (which
 * calls the `lock_fixation` SECURITY DEFINER RPC — the only write door; idempotent
 * on a tenant-qualified key; appends the `'fixation_locked'` lot_event in the same
 * txn; RAISES on a reserve quote).
 *
 * Server Actions are the driving port (ADR-002 — only ever invoked by an
 * authenticated human submitting the cockpit's confirm dialog), satisfying the
 * injection invariant (rail #7: a money-shaped instrument is human-confirmed,
 * never auto). The command owns validation + friendly-error mapping; this thin
 * action binds the request-scoped Supabase client, adapts the command's result
 * envelope to the cockpit's `{ ok } | { ok:false; error }` shape, and busts the
 * affected RSC caches on success.
 *
 * ⚠️ WIRING DEPENDENCY (bundle with the i18n/nav registration the Wiring pass
 * already owns): `reactiveRefresh("fixation-locked")` needs the EventKind wired,
 * which is NOT in this slice's file-disjoint scope:
 *   • src/lib/revalidate.ts — add to `EventKind` + RIPPLE:
 *       "fixation-locked": ["/hedge", "/pricing", "/pricing/[lot]", "/lots/[code]"]
 *   • src/lib/__tests__/ripple-actions-wired.test.ts — add to KIND_TO_ACTION_FILES:
 *       "fixation-locked": ["app/hedge/actions.ts"]   (so checks B/D stay green)
 * Going through `reactiveRefresh` (never a hand-rolled `revalidatePath`) keeps the
 * RIPPLE map the single SSOT — the `ripple-actions-wired` guard enforces exactly this.
 */
export async function lockFixationAction(
  input: LockFixationInput,
): Promise<LockFixationResult> {
  const sb = await getSupabase();

  // The command validates `quoteId` (positive integer) + `idempotencyKey`, calls
  // the RPC once, and surfaces the regime-guard / must-be-accepted / no-mark raises
  // as clean sentences. Map its richer envelope onto the cockpit's flat one.
  const result = await lockFixation(sb as unknown as LockFixationStore, {
    quoteId: input.priceQuoteId,
    idempotencyKey: input.idempotencyKey,
  });

  if (!result.ok) {
    const error =
      result.message ??
      (result.errors ? Object.values(result.errors)[0] : undefined) ??
      "Could not lock the fixation. Check the entry and try again.";
    return { ok: false, error };
  }

  // A fixation moves the cockpit (this lot drops off the un-fixed list), the price
  // book, the per-lot composer, and the lot dossier's commercial history.
  reactiveRefresh("fixation-locked");
  return { ok: true, fixationId: result.fixationId };
}
