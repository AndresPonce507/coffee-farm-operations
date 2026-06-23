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
  **and** `npm run test` green — every PR now ships tests (see below), so the suite is never empty —
  **run locally**. That replaces CI. Enforced by discipline, not a git hook (Andres's call, 2026-06-20).

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
- **TDD test-first on EVERY PR — no exemptions** (standing rule, set 2026-06-20). Every PR ships at
  least one test, written **before** the code it covers:
  - **Logic** (mappers, persistence, validation, calcs, seed gen): full red→green→refactor — write one
    failing test, watch it fail for the *right* reason, minimum code to green, refactor on green.
  - **Pure UI / glass / copy / config:** at minimum a **render/smoke test** (component mounts, key
    content/structure renders, no throw). A Tailwind/glass tweak still ships a test asserting the
    element renders. The old "UI prototype is exempt" carve-out is **gone**.
  - **Bug fix:** regression test that FAILS on the pre-fix code, same commit.
  No production/UI code without a failing test demanding it; test behavior through the public surface,
  not implementation detail. Prereq: render/smoke tests need jsdom + @testing-library/react (vitest env
  is currently `node`) — set up before the first UI PR under this rule.
- **Parallelism — judicious, not maximal:** fan out concurrent agents only when work genuinely
  decomposes into independent, file-disjoint slices and the speedup clearly outweighs the overhead;
  otherwise work sequentially. Keep waves small, one author for shared/contract files, always close
  with a reviewer pass. (The old "always maximize parallelism / 50+ agents" mandate was removed
  2026-06-22 — no standing max-agents rule.)
- Tests + docs ship with the feature; bug → regression test in the same commit.

## Contract — don't fork these
`src/lib/**` (domain types + mock data), `src/app/globals.css` (the glass system), and the finalized
shared shell/primitives (`src/components/layout/*`, `card.tsx`, `badge.tsx`, `stat-card.tsx`) are the
source of truth. Extend them; don't duplicate or diverge.
