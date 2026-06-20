/*
  ============================================================================
  Janson Coffee — Farm Operations · LIQUID-GLASS POLISH WORKFLOW (~51 agents)
  ============================================================================
  This is a ready-to-run Claude Code Workflow script. It is the pending
  "per-section glass + motion + perf" fan-out that was queued but not yet run.

  HOW TO RUN (in a Claude Code session, in this repo):
    Workflow({ scriptPath: "/Users/andres/coffee-farm-operations/docs/glass-polish-workflow.js" })
  (or paste its contents into Workflow's `script` param)

  ONE KNOB: if the repo lives at a different absolute path, edit ROOT below.

  SAFETY MODEL (file-disjoint, one agent per file):
    Phase 1 "Glass, motion & perf"  — 38 agents: 9 primitives + 4 charts + 25 sections
    Phase 2 "Skeletons"             —  6 agents: per-route loading.tsx (new files)
    Phase 3 "Review & build"        —  7 agents: build-fixer, then 6 read-only reviewers
  Off-limits files (already finalized) are listed in GLASS_GUIDE and must not be touched.
  ============================================================================
*/

export const meta = {
  name: 'janson-glass-polish',
  description: 'Liquid-glass + motion + perf polish of Janson Coffee Farm Operations: 38 file-disjoint polish agents, 6 loading skeletons, build-fixer + 6 reviewers (~51 agents)',
  phases: [
    { title: 'Glass', detail: 'Per-file glass + motion + perf polish — primitives, charts, sections (parallel)' },
    { title: 'Skeletons', detail: 'Per-route loading.tsx glass skeletons (parallel)' },
    { title: 'Review', detail: 'Build-fixer to green, then 6 read-only reviewers' },
  ],
}

const ROOT = '/Users/andres/coffee-farm-operations'

const GLASS_GUIDE = [
  'PROJECT: Janson Coffee — Farm Operations (practice app for a real family coffee farm in Volcan, Panama). Next.js 15 App Router + React 19 + TypeScript (strict) + Tailwind CSS v4. Repo root: ' + ROOT + '. Import alias @/ maps to src/. The app has just received a LIQUID-GLASS design-system upgrade; you are polishing ONE file to match it.',
  '',
  'THE GLASS SYSTEM (already defined in src/app/globals.css — USE these utilities, never redefine them):',
  '- glass        : true frosted glass WITH backdrop-blur. ONLY for floating chrome/overlays. NEVER put on content cards.',
  '- glass-card   : translucent gloss card, NO blur (stays 60fps at scale). The Card primitive already uses this.',
  '- glass-forest : deep-forest glass (sidebar).',
  '- glass-hover  : GPU hover-lift (translateY + deeper shadow). Add to interactive / feature cards and tiles.',
  '- glass-sheen  : specular light sweep on hover. Use on AT MOST ONE hero/feature surface per file.',
  '- stagger      : put on a grid/list CONTAINER so its direct children rise in sequence (drop per-child animate-rise when you do).',
  '- animate-rise : single entrance for a top-level wrapper.',
  '- perf-contain : contain:content (put on card grids). cv-auto : content-visibility:auto (put on long tables/boards 10+ rows and tall scroll regions).',
  'A global LivingBackground (drifting aurora blobs + frosted grain) already sits behind everything; every surface floats over it.',
  '',
  'WHAT TO DO (enhance your ONE file IN PLACE — read it first, keep its structure/data/API):',
  '1. Surfaces: any opaque/ad-hoc card (raw bg-card / bg-white bordered divs, inner tiles, kanban cards, leaderboard rows) -> give it the glass look: use the Card component, or add "glass-card rounded-2xl"; for lighter inner tiles use "rounded-xl border border-white/60 bg-white/55". Remove solid bg-card / ring-card in favor of glass.',
  '2. Depth and life: add glass-hover to clickable/feature cards and tiles; add glass-sheen to the single most important surface only.',
  '3. Motion: wrap the main grid/list in "stagger" so children rise in sequence; keep one animate-rise on the outer wrapper. Subtle, 200-400ms, transform/opacity ONLY.',
  '4. Performance: add cv-auto to long tables/boards and perf-contain to card grids. NEVER add backdrop-blur to content cards (chrome only). No new dependencies, no framer-motion.',
  '5. Contrast: honey TEXT on light backgrounds must be text-honey-700 (not text-honey). Keep #C8922E / text-honey only for icons, fills and chart colors.',
  '6. Stay on-brand: only paper/card/muted/ink/line + forest/coffee/cherry/honey/sky tokens. Do NOT change any data or component prop API.',
  '',
  'OFF-LIMITS — never modify these (already finalized): src/app/globals.css, src/app/layout.tsx, src/app/(app)/layout.tsx, src/components/ui/card.tsx, src/components/ui/badge.tsx, src/components/ui/stat-card.tsx, src/components/layout/* , src/lib/* . Touch ONLY your assigned file.',
  '',
  'RULES: TypeScript strict (no any). Keep "use client" exactly as-is (only add if the file already uses hooks/handlers and is missing it; never remove it). Do not run npm or next. Do not modify other files. Quality bar: world-class, buttery-smooth, Apple-grade liquid glass — this ships to the owner’s real family coffee farm.',
].join('\n')

// ---- Phase 1 targets: { path, label, hint } -------------------------------
const ui = (n) => ROOT + '/src/components/ui/' + n + '.tsx'
const ch = (n) => ROOT + '/src/components/charts/' + n + '.tsx'
const sec = (p, n) => ROOT + '/src/components/sections/' + p + '/' + n + '.tsx'

const POLISH = [
  // primitives (9)
  { path: ui('button'), label: 'ui:button', hint: 'Give variants gloss: primary forest with an inset top highlight (e.g. shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)]) and a subtle hover lift; outline -> translucent glass (bg-white/60 border-white/60); add active:scale-[.98] and a smooth transition. Keep the variant/size API identical.' },
  { path: ui('tile'), label: 'ui:tile', hint: 'Light touch — ensure it reads cleanly on glass; keep icon chips subtle. No structural/API change.' },
  { path: ui('chip'), label: 'ui:chip', hint: 'Glassy: inactive -> translucent (bg-white/55 border-white/60) with a subtle hover lift; active stays forest with a faint gloss. Keep API.' },
  { path: ui('segmented'), label: 'ui:segmented', hint: 'Glass track (bg-white/50) with a glass-card selected thumb and a smooth transition. Keep "use client" and API.' },
  { path: ui('data-table'), label: 'ui:data-table', hint: 'Header row gets a faint glass tint (bg-white/40); row hover bg-white/50; keep the rounded glass wrapper. This primitive powers ALL tables — keep it generic and its exports identical.' },
  { path: ui('progress-bar'), label: 'ui:progress-bar', hint: 'Add a subtle inner gloss to the fill and keep the smooth width transition; optional faint glow. Keep API.' },
  { path: ui('page-header'), label: 'ui:page-header', hint: 'Subtle — crisp title; optionally a hairline gradient divider beneath. Keep API.' },
  { path: ui('avatar'), label: 'ui:avatar', hint: 'Add ring-1 ring-white/60 and a soft shadow for depth on glass. Keep API.' },
  { path: ui('empty-state'), label: 'ui:empty-state', hint: 'Glassy icon chip (bg-white/55). Light touch.' },
  // charts (4)
  { path: ch('bar-mini'), label: 'chart:bar-mini', hint: 'Premium bars: vertical gradient (lighter top), rounded tops, subtle drop shadow, hover highlight. Keep API + role="img".' },
  { path: ch('donut'), label: 'chart:donut', hint: 'Add a soft inner shadow/gradient and a faint glow; keep rounded caps and API.' },
  { path: ch('trend-line'), label: 'chart:trend-line', hint: 'Richer gradient area fill + a subtle glow under the line + an endpoint dot. Keep API + non-scaling stroke.' },
  { path: ch('stat-ring'), label: 'chart:stat-ring', hint: 'Gradient stroke + soft glow; rounded caps; make the center value read luminous. Keep API.' },
  // dashboard sections (8)
  { path: sec('dashboard', 'season-hero'), label: 'sec:season-hero', hint: 'HERO showpiece — the first thing the family sees. Add glass-sheen + glass-hover to the main panel, deepen the forest/gradient glass, make the StatRing feel luminous. This should be the single biggest visual upgrade.' },
  { path: sec('dashboard', 'kpi-row'), label: 'sec:kpi-row', hint: 'Wrap the 4-StatCard grid in a "stagger" container so cards rise in sequence; add perf-contain. (StatCards already have glass-hover.)' },
  { path: sec('dashboard', 'yield-trend-card'), label: 'sec:yield-trend-card', hint: 'Chart card — add glass-hover; give the TrendLine breathing room. Subtle.' },
  { path: sec('dashboard', 'variety-mix-card'), label: 'sec:variety-mix-card', hint: 'Donut + legend card — glass-hover; faint hover tint on legend rows.' },
  { path: sec('dashboard', 'activity-feed-card'), label: 'sec:activity-feed-card', hint: 'Timeline list — add "stagger" to the list; subtle per-row hover tint; keep it calm.' },
  { path: sec('dashboard', 'weather-strip-card'), label: 'sec:weather-strip-card', hint: 'Forecast tiles — make each day a light glass tile (rounded-xl border border-white/60 bg-white/55) with glass-hover; honey sun / sky rain icons.' },
  { path: sec('dashboard', 'plot-health-card'), label: 'sec:plot-health-card', hint: 'Status list with progress bars — subtle row hover; problems already sort first. Optional glass-hover on rows.' },
  { path: sec('dashboard', 'processing-pipeline-card'), label: 'sec:processing-pipeline-card', hint: 'Horizontal stepper — glassy stage chips; allow horizontal scroll; add cv-auto.' },
  // plots (3)
  { path: sec('plots', 'plots-summary'), label: 'sec:plots-summary', hint: 'Tile strip inside a Card (already glass) — ensure dividers read on glass; optionally stagger the tiles. Light touch.' },
  { path: sec('plots', 'plots-explorer'), label: 'sec:plots-explorer', hint: 'CENTERPIECE grid (client) — wrap the card grid in "stagger" + perf-contain; each plot card: glass-card glass-hover, plus glass-sheen for the liquid feel; make the filter chips/segmented glassy. KEEP the useState filtering intact.' },
  { path: sec('plots', 'plots-table'), label: 'sec:plots-table', hint: 'TABLE — add cv-auto to the table wrapper; ensure header reads on glass; row hover bg-white/50.' },
  // harvests (4)
  { path: sec('harvests', 'harvest-summary'), label: 'sec:harvest-summary', hint: 'Tile strip in a Card — dividers on glass; optional stagger.' },
  { path: sec('harvests', 'harvest-trend-card'), label: 'sec:harvest-trend-card', hint: 'BarMini chart card — glass-hover; breathing room.' },
  { path: sec('harvests', 'top-pickers-card'), label: 'sec:top-pickers-card', hint: 'Leaderboard rows — glass-hover on rows; premium bars; avatars get ring-white/60.' },
  { path: sec('harvests', 'harvest-log-table'), label: 'sec:harvest-log-table', hint: 'TABLE — add cv-auto; header on glass; row hover.' },
  // workers (4)
  { path: sec('workers', 'worker-summary'), label: 'sec:worker-summary', hint: 'Tile strip in a Card — dividers on glass; optional stagger.' },
  { path: sec('workers', 'attendance-card'), label: 'sec:attendance-card', hint: 'Donut + legend card — glass-hover.' },
  { path: sec('workers', 'crew-board'), label: 'sec:crew-board', hint: 'Crew sub-panels -> light glass tiles (glass-card) with glass-hover; overlapping avatars get ring-white/60.' },
  { path: sec('workers', 'worker-roster-table'), label: 'sec:worker-roster-table', hint: 'TABLE — add cv-auto; header on glass; row hover.' },
  // processing (3)
  { path: sec('processing', 'processing-summary'), label: 'sec:processing-summary', hint: 'Tile strip in a Card — dividers on glass; optional stagger.' },
  { path: sec('processing', 'stage-pipeline'), label: 'sec:stage-pipeline', hint: 'KANBAN centerpiece — batch tiles become light glass cards (glass-card glass-hover); columns in a horizontal scroll; add cv-auto + perf-contain; stagger the columns.' },
  { path: sec('processing', 'batch-table'), label: 'sec:batch-table', hint: 'TABLE — add cv-auto; header on glass; row hover.' },
  // tasks (3)
  { path: sec('tasks', 'task-summary'), label: 'sec:task-summary', hint: 'Tile strip in a Card — dividers on glass; optional stagger.' },
  { path: sec('tasks', 'task-board'), label: 'sec:task-board', hint: 'KANBAN centerpiece — task tiles glass-card glass-hover; stagger the columns/tiles; keep priority dots; overdue due-dates in cherry; add cv-auto.' },
  { path: sec('tasks', 'task-table'), label: 'sec:task-table', hint: 'TABLE — add cv-auto; header on glass; row hover.' },
]

// ---- Phase 2: per-route loading.tsx skeletons -----------------------------
const LOADING = [
  { path: ROOT + '/src/app/(app)/loading.tsx', pagePath: ROOT + '/src/app/(app)/page.tsx', label: 'skeleton:dashboard', hint: 'Mirror the dashboard: a hero band block, a 4-up KPI row, then a 3-col grid (2/3 chart area + 1/3 stacked cards).' },
  { path: ROOT + '/src/app/(app)/plots/loading.tsx', pagePath: ROOT + '/src/app/(app)/plots/page.tsx', label: 'skeleton:plots', hint: 'header bar + summary strip + filter toolbar + 3-col card grid + a table block.' },
  { path: ROOT + '/src/app/(app)/harvests/loading.tsx', pagePath: ROOT + '/src/app/(app)/harvests/page.tsx', label: 'skeleton:harvests', hint: 'header + summary + (2/3 chart + 1/3 leaderboard) + table block.' },
  { path: ROOT + '/src/app/(app)/workers/loading.tsx', pagePath: ROOT + '/src/app/(app)/workers/page.tsx', label: 'skeleton:workers', hint: 'header + summary + (donut card + crew grid) + table block.' },
  { path: ROOT + '/src/app/(app)/processing/loading.tsx', pagePath: ROOT + '/src/app/(app)/processing/page.tsx', label: 'skeleton:processing', hint: 'header + summary + horizontal kanban row + table block.' },
  { path: ROOT + '/src/app/(app)/tasks/loading.tsx', pagePath: ROOT + '/src/app/(app)/tasks/page.tsx', label: 'skeleton:tasks', hint: 'header + summary + 4-col kanban + table block.' },
]

function polishPrompt(t) {
  return GLASS_GUIDE +
    '\n\nYOUR FILE (edit in place): ' + t.path +
    '\nSPECIFIC POLISH: ' + t.hint +
    '\n\nRead the file, enhance it per the rules above, and write it back. Touch ONLY this file.'
}
function loadingPrompt(t) {
  return GLASS_GUIDE +
    '\n\nYOUR TASK — create a NEW Next.js route loading file (default export, server component): ' + t.path +
    '\nIt shows an INSTANT glass skeleton while the route loads. Mirror the layout of its page (read it first): ' + t.pagePath +
    '\nStructure to suggest: ' + t.hint +
    '\nUse glass-card rounded-2xl blocks with Tailwind animate-pulse and muted bars (bg-muted / bg-line) for the header, the KPI/summary row, and the main content. Keep spacing consistent (space-y-6). Lightweight, no data imports, no client JS. Write ONLY this file.'
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'issues'],
  properties: {
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['severity', 'file', 'note'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          note: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

// ============================== RUN ==============================
phase('Glass')
log('Polishing ' + POLISH.length + ' files (primitives + charts + sections) in parallel')
const polished = await parallel(POLISH.map((t) => () => agent(polishPrompt(t), { label: t.label, phase: 'Glass' })))
log('Glass polish done: ' + polished.filter(Boolean).length + '/' + POLISH.length)

phase('Skeletons')
const skeletons = await parallel(LOADING.map((t) => () => agent(loadingPrompt(t), { label: t.label, phase: 'Skeletons' })))
log('Skeletons done: ' + skeletons.filter(Boolean).length + '/' + LOADING.length)

phase('Review')
const buildFixerPrompt = GLASS_GUIDE +
  '\n\nYOU ARE THE BUILD FIXER. Working dir: ' + ROOT +
  '\nRun: cd ' + ROOT + ' && npm run build (Next.js 15 production build).' +
  '\nFix ONLY compile/type/import/client-directive errors caused by the glass polish — minimal surgical changes, no redesign. Common fixes: add a missing "use client"; correct an import path/name; fix a prop-type mismatch; remove a bad arbitrary Tailwind class. Re-run after each batch, iterate up to 6 times until the build succeeds (exit 0). Report final status + every file changed and why. If still failing after 6 iterations, report remaining errors verbatim.'
const build = await agent(buildFixerPrompt, { label: 'build-fixer', phase: 'Review', agentType: 'general-purpose', effort: 'high' })

const R = (focus) => GLASS_GUIDE + '\n\nREAD-ONLY REVIEW — ' + focus + ' Inspect files under ' + ROOT + '/src. Do NOT edit anything; report findings only with file + severity + a concrete fix.'
const reviews = await parallel([
  () => agent(R('VISUAL FIDELITY: does it read as world-class, Apple-grade liquid glass? consistent gloss/depth, hero surfaces shine, nothing looks flat or muddy.'), { label: 'review:visual', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(R('GLASS CONSISTENCY: glass utilities applied consistently; no leftover opaque bg-card surfaces; no double-glass; sheen used sparingly (<=1 per view).'), { label: 'review:glass', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(R('MOTION: stagger/hover/sheen tasteful and consistent; transform/opacity only (no layout-property animation); prefers-reduced-motion respected; no jank.'), { label: 'review:motion', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(R('PERFORMANCE BUDGET: NO backdrop-blur on content cards (chrome only); client components still minimal (sidebar/segmented/plots-explorer only); cv-auto on long tables/boards; no new deps; bundle stays small.'), { label: 'review:perf', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(R('ACCESSIBILITY + CONTRAST: honey text uses honey-700; text on translucent glass stays >=4.5:1; focus-visible states present; charts keep role="img"; status not color-only.'), { label: 'review:a11y', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(R('MOBILE/RESPONSIVE: grids collapse to 1 col on small screens; kanban/boards scroll horizontally; glass + sheen behave on touch; nothing overflows.'), { label: 'review:mobile', phase: 'Review', schema: REVIEW_SCHEMA }),
])

return {
  polished: polished.filter(Boolean).length + '/' + POLISH.length,
  skeletons: skeletons.filter(Boolean).length + '/' + LOADING.length,
  build,
  reviews: reviews.filter(Boolean),
}
