// PHASE-2 MEGA-REVIEW — VERIFY-ONLY continuation.
// The find phase is DONE (203 raw findings in ~/HANDOFF-phase2-review-snapshot.json).
// This finishes the review: adversarially verify each finding (refute-by-default), synthesize confirmed.
//
// HOW TO RUN (in the new session):
//   1. Read ~/HANDOFF-phase2-review-snapshot.json and grab its `findings` array (203 items).
//   2. Workflow({ scriptPath: "/Users/andres/phase2-review-verify.js", args: { findings: <that array> } })
//   3. The result is { confirmedCount, bySeverity, confirmed:[...] } — then FIX every confirmed finding
//      test-first (fan out file-disjoint agents), re-gate, land on main.
//
// (Findings come via `args` because workflow scripts have no filesystem access.)

export const meta = {
  name: 'phase2-review-verify',
  description: 'Adversarially verify the 203 frozen phase-2 review findings (refute-by-default) → confirmed list',
  phases: [
    { title: 'Verify', detail: 'each non-LOW finding gets skeptics that try to REFUTE it against the real code' },
    { title: 'Synthesize', detail: 'survivors ranked by severity' },
  ],
}

const ROOT = '/Users/andres/coffee-farm-operations-worktrees/phase1-deliver'

const BASE = `
You are adversarially VERIFYING a phase-2 review finding for the Janson Coffee farm-ops app (Next.js 15 +
React 19 + TS + Tailwind v4 + Supabase). All 6 phase-2 foundation slices are on \`main\` (read the real code on
disk at ${ROOT}: migrations supabase/migrations/2026062209*.sql..2026062210*.sql, src/lib/db/*, commands,
src/components/sections/*, src/app/(app)/*). You MAY run read-only shell + the test suite + a throwaway PGlite
replay (then DELETE it). Conventions that are NOT bugs: authenticated-only RLS (NO farm_id — multi-tenant is a
later slice); SECURITY DEFINER command-RPC write door with pinned search_path; AD-8 grants (nothing to anon);
append-only hash-chained ledgers; the shared Dialog is portal-fixed to <body>. Key invariants the review
targeted: reposo gate (S4), QC-hold (S6), append-only ledgers, oversell, cert+PHI/REI spray gate (S12),
dispatch injection-safety (S5).

Your job: DEFAULT isReal=FALSE. Flip to TRUE only if you REPRODUCE the defect by reading the actual code/SQL
(or a throwaway replay). Re-rate severity (INVALID if not real / already handled / a misread of the conventions
above). Give the minimal correct fix. Be skeptical — most plausible-sounding findings are wrong on close read.
`

const VERDICT = {
  type: 'object', additionalProperties: false, required: ['isReal', 'severity', 'confidence', 'reasoning'],
  properties: {
    isReal: { type: 'boolean' }, severity: { enum: ['CRIT', 'HIGH', 'MED', 'LOW', 'INVALID'] },
    confidence: { enum: ['high', 'medium', 'low'] }, reasoning: { type: 'string' }, correctedFix: { type: 'string' },
  },
}

const all = (args && args.findings) || (Array.isArray(args) ? args : []) || []
// normalize slice label to leading S<n>; dedupe by (slice,file,location,title)
const norm = (s) => (String(s || '').match(/S\d+/) || ['S?'])[0]
const seen = new Set()
const findings = []
for (const f of all) {
  if (!f || typeof f !== 'object') continue
  const k = norm(f.slice) + '|' + (f.file || '') + '|' + (f.location || '') + '|' + String(f.title || '').slice(0, 60)
  if (seen.has(k)) continue
  seen.add(k); findings.push({ ...f, slice: norm(f.slice) })
}
const toVerify = findings.filter((f) => f.severity !== 'LOW')
log(`Verifying ${toVerify.length} non-LOW findings (of ${findings.length} deduped); LOW skipped`)

phase('Verify')
const verified = await parallel(toVerify.map((f) => () => {
  const n = (f.severity === 'CRIT' || f.severity === 'HIGH') ? 2 : 1
  return parallel(Array.from({ length: n }, (_, i) => () =>
    agent(
      `${BASE}\n\n========================================\nADVERSARIAL VERIFICATION (skeptic ${i + 1}/${n}).\n\nFINDING [${f.slice} · ${f.dimension || '?'}]\nTitle: ${f.title}\nFile: ${f.file} @ ${f.location}\nSeverity: ${f.severity}\nProblem: ${f.problem}\nScenario: ${f.scenario}\nProposed fix: ${f.fix}\n\nReproduce against the real code. Is it a REAL defect reachable on main (or clearly latent — say which)? Re-rate (INVALID if not). Minimal correct fix.`,
      { label: `verify:${f.slice}:${String(f.file || '').split('/').pop()}`, phase: 'Verify', schema: VERDICT },
    )))
    .then((votes) => {
      const v = votes.filter(Boolean)
      const real = v.length > 0 && v.filter((x) => x.isReal && x.severity !== 'INVALID').length >= Math.ceil(v.length / 2)
      const hit = v.find((x) => x.isReal && x.severity !== 'INVALID') || {}
      return { finding: f, real, severity: hit.severity || f.severity, confidence: (v[0] || {}).confidence, reasoning: (hit.reasoning || (v[0] || {}).reasoning), correctedFix: (v.find((x) => x.correctedFix) || {}).correctedFix }
    })
}))

phase('Synthesize')
const confirmed = verified.filter(Boolean).filter((x) => x.real).map((x) => ({
  title: x.finding.title, slice: x.finding.slice, dimension: x.finding.dimension,
  file: x.finding.file, location: x.finding.location, severity: x.severity, confidence: x.confidence,
  problem: x.finding.problem, scenario: x.finding.scenario, fix: x.correctedFix || x.finding.fix, reasoning: x.reasoning,
}))
const ord = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 }
confirmed.sort((a, b) => (ord[a.severity] - ord[b.severity]) || a.slice.localeCompare(b.slice))
const bySeverity = confirmed.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {})
const bySlice = confirmed.reduce((m, f) => ((m[f.slice] = (m[f.slice] || 0) + 1), m), {})
log(`CONFIRMED after verification: ${JSON.stringify(bySeverity)} — by slice ${JSON.stringify(bySlice)}`)
return { verifiedCount: toVerify.length, confirmedCount: confirmed.length, bySeverity, bySlice, confirmed }
