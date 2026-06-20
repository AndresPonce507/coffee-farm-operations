# CLAUDE.md — Janson Coffee · Farm Operations

Project-level instructions for Claude Code in **this repo**. This layers **on top of**
the global `~/.claude/CLAUDE.md` (Andres's portable workflow, which applies to every repo
automatically). Where they conflict, **this file wins** — it adapts the standard workflow
for a **$0, no-CI practice project**.

## What this is
A practice/portfolio app for **Janson Coffee** (real family farm, Volcán, Chiriquí, Panamá).
Next.js 15 App Router + React 19 + TypeScript + Tailwind v4. In-repo **mock data** (`src/lib/data/*`),
no backend. See `README.md` for the design system and `HANDOFF.md` to resume the build.

## $0 / no-CI overrides (the important part)
- **No paid services, ever.** No database, no hosted infra that bills. (A future DB, if added,
  must use a free tier — Supabase/Neon/Turso.)
- **No GitHub Actions / no CI.** Do **not** add `.github/workflows`. There is no remote pipeline.
- The global rules that reference CI ("green trunk is a contract", "red CI = stop-the-line",
  Supabase migrations, `db:push`, `develop`/`main` protected branches, deploy cadence) **do not apply** —
  there is no CI, no database, and no employer infra here. The **methodology** carries over; the
  **infrastructure-specific rules do not**.
- **Quality gate = local.** Before any merge to `main`, the gate is: `npm run build` green
  (and, once logic/tests exist, the test suite green) **run locally**. That replaces CI.

## Git workflow (carried from TradelyHQ, adapted for solo + no-CI)
- Work on a **feature branch**, open a **PR**, merge to **`main`** (squash or merge — your call).
  Solo repo, so Andres merges on his cadence. Don't force-push shared branches; use
  `--force-with-lease` only, never plain `--force`.
- No `develop` integration branch by default (its job is to gate CI before `main` — pointless
  without CI). If Andres wants the feature→develop→main muscle memory anyway, add it on request.
- `git status` before every commit; never commit `node_modules/`, `.next/`, `.env*`, or editor junk
  (already in `.gitignore`). End commit messages with the standard
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

## Quality bar & method (unchanged from global)
- **Liquid glass:** world-class, buttery-smooth, performance-optimized. Real `backdrop-blur`
  only on floating chrome; content cards use no-blur "glass-lite". GPU-only transforms,
  `prefers-reduced-motion`, mostly Server Components for a tiny JS bundle.
- **TDD for new logic** (the method, tool-independent). The app is currently a UI prototype with
  mock data; when persistence/logic lands, build it test-first with local tests.
- **Massive parallelism:** fan out **50+ agents** (or the max possible) for substantive work via the
  Workflow tool — file-disjoint writers, one author for shared/contract files, reviewer pass to close.
- Tests + docs ship with the feature; bug → regression test in the same commit.

## Contract — don't fork these
`src/lib/**` (domain types + mock data), `src/app/globals.css` (the glass system), and the finalized
shared shell/primitives (`src/components/layout/*`, `card.tsx`, `badge.tsx`, `stat-card.tsx`) are the
source of truth. Extend them; don't duplicate or diverge.
