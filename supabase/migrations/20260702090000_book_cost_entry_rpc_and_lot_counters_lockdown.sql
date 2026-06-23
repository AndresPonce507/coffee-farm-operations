-- 20260702090000 — book_cost_entry SECDEF RPC + lot_counters cross-tenant lockdown
--
-- Round-A adversarial-review remediation. Two findings, both rooted in the P4-S0
-- tenant RLS enforcement merge (20260701092000):
--
-- CRIT — `bookCostEntry` (costing/actions.ts) was a DIRECT `insert into cost_entry`,
--   but 20260701092000 made cost_entry an APPEND-ONLY LEDGER with NO insert policy
--   for `authenticated` (the four ledgers are read-only at the policy layer; writes
--   flow through SECURITY DEFINER RPCs that self-clamp the tenant). So every cost
--   booking from the /costing UI is now RLS-denied — the feature is broken on the
--   tenant-enforced schema. This adds the missing write door, `book_cost_entry`: a
--   SECDEF RPC that resolves the session tenant, fails closed on null, and stamps
--   tenant_id LITERALLY on the append (mirroring record_disbursement). The table
--   CHECKs (amount >= 0, the farm-vs-plot/lot shape) and the append-only immutability
--   trigger remain the real enforcement — SECURITY DEFINER bypasses RLS, not CHECKs.
--   The action keeps its `reaches_green` pre-check for the friendly COGS-orphan error.
--
-- MED — lot_counters granted SELECT to `authenticated` with NO row security, leaking
--   every tenant's next_val (a write-volume hint) cross-tenant. It is written ONLY via
--   the SECDEF _next_lot_code (which bypasses grants) and is read by NO app getter, so
--   revoke the grant: the leak closes, the minter is unaffected, and the table stays
--   out of the RLS parity set (relrowsecurity stays false — the §8 guard is unaffected).

-- ── book_cost_entry — the SECDEF write door for the cost_entry ledger ─────────────
create or replace function book_cost_entry(
  p_driver          text,
  p_allocation_rule text,
  p_target_kind     text,
  p_target_code     text,
  p_amount_usd      numeric,
  p_memo            text
) returns bigint
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_id     bigint;
begin
  if v_tenant is null then
    raise exception 'no tenant in session' using errcode = 'insufficient_privilege';
  end if;
  -- The one legal append. tenant_id is stamped LITERALLY (not left to a column
  -- default) so the row is same-tenant even if the default ever drifts. occurred_at
  -- = now() mirrors record_disbursement. The CHECK constraints + immutability trigger
  -- still fire here (SECURITY DEFINER bypasses RLS, not table CHECKs).
  insert into cost_entry
    (tenant_id, driver, allocation_rule, target_kind, target_code, amount_usd, memo, occurred_at)
  values
    (v_tenant, p_driver, p_allocation_rule, p_target_kind, p_target_code, p_amount_usd, p_memo, now())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function book_cost_entry(text, text, text, text, numeric, text) from public;
grant   execute on function book_cost_entry(text, text, text, text, numeric, text) to authenticated;

-- ── lot_counters — close the cross-tenant next_val read leak ──────────────────────
-- Written only via _next_lot_code (SECDEF, bypasses grants); no app read path. RLS
-- stays disabled so the §8 parity guard (which scans relrowsecurity=true tables) is
-- unaffected; we simply remove the over-broad read grant that exposed every tenant's
-- counter to every authenticated user.
revoke select on lot_counters from authenticated;
