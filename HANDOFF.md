# HANDOFF — resume the liquid-glass build here

> For the next Claude Code session (possibly a different account). Everything needed is in this repo — no prior chat context required.

## ▶︎ Resume in one line (paste this into the new session)

> Resume the Janson Coffee Farm Operations build at `/Users/andres/coffee-farm-operations`. Read `HANDOFF.md` and `CLAUDE.md`, then run the liquid-glass polish workflow (50+ agents): `Workflow({ scriptPath: "/Users/andres/coffee-farm-operations/docs/glass-polish-workflow.js" })`. When it finishes, run `npm run build`, start the dev server, and smoke-test every route in the browser.

That sentence is also the explicit opt-in the Workflow tool needs to fan out 50+ agents.

## Where things stand

- **Repo:** https://github.com/AndresPonce507/coffee-farm-operations (public) · branch `main`
- **Build:** green (`npm run build` exit 0) · `node_modules` already present on this machine
- **Done:**
  - Full structural app — 6 routes (dashboard, plots, harvests, workers, processing, tasks), 25 sections, mock-data layer, custom SVG charts (built by a 55-agent fan-out; brand + a11y reviewed)
  - **System-level liquid-glass foundation** — glass utilities + living aurora background + glass sidebar/topbar/cards + motion tokens + honey-contrast fix (all in `src/app/globals.css` and the shared shell/primitives)
- **Pending (the next fan-out):** per-section glass/motion/perf polish, loading skeletons, reviewer pass — encoded in `docs/glass-polish-workflow.js`.

## The pending fan-out (~51 agents, already written)

```
Workflow({ scriptPath: "/Users/andres/coffee-farm-operations/docs/glass-polish-workflow.js" })
```

- **Phase 1 — Glass:** 38 file-disjoint agents polish primitives + charts + 25 sections (glass-hover, glass-sheen on heroes, `stagger` grids, convert inner tiles/kanban cards to glass, `cv-auto`/`perf-contain` on tables & boards).
- **Phase 2 — Skeletons:** 6 per-route `loading.tsx` glass shimmer skeletons.
- **Phase 3 — Review:** a build-fixer iterates `npm run build` to green, then 6 read-only reviewers (visual / glass / motion / perf / a11y / mobile) return structured findings.

Safety: one agent per file (file-disjoint), off-limits files declared in the script, build-fixer + reviewers close the loop.

## After the workflow returns

1. Confirm `npm run build` is green (the build-fixer reports this).
2. `npm run dev` → http://localhost:3000 — smoke-test each route in the browser, confirm the console is clean and the glass/motion looks right.
3. Triage reviewer findings; dispatch a small fix fan-out for any high-severity items; re-build.
4. Optional: screenshots; optional free Vercel Hobby deploy (still $0).

## Guardrails — do not break these

- **$0 forever:** no database, no paid services, **no GitHub Actions / CI**.
- **Quality bar:** world-class, buttery-smooth, performance-optimized **liquid glass**.
- `src/lib/**` and the finalized shared shell/primitives are the **contract** — extend, don't fork.
- Fan out **50+ agents** for substantive work (file-disjoint writers, one author for shared files, reviewer pass).

## Repo map

| File | What |
|---|---|
| `README.md` | Project overview + design-system reference |
| `CLAUDE.md` | Workflow conventions for this repo (carried from TradelyHQ, minus CI) |
| `docs/glass-polish-workflow.js` | The ready-to-run polish workflow (above) |
| `src/app/globals.css` | The liquid-glass system (tokens + utilities + motion + perf) |
| `src/lib/**` | Domain types + mock data (the contract) |
