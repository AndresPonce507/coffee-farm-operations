# Janson Coffee — Farm Operations

> Operations console for **Janson Coffee**, Volcán, Chiriquí, Panamá — _from our farm to your cup since 1990_.
> A practice / portfolio build: plots, harvests, processing, labor and tasks, in a world-class **liquid-glass** UI.

This is a self-contained front-end app with an in-repo **mock-data layer** — no database, no paid services, no CI. It runs for **$0** locally and deploys free to Vercel Hobby if you ever want it online.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

`npm run build` produces an optimized production build (currently green ✅).

---

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** (CSS-first `@theme` tokens, no config file)
- **lucide-react** icons · custom **SVG charts** (no chart dependency)
- Mock data only — `src/lib/data/*`

Mostly **Server Components** (tiny JS bundle); only `sidebar`, `segmented`, and `plots-explorer` ship client JS.

---

## Architecture

```
src/
  app/
    layout.tsx            # root: fonts (Inter + Quicksand), metadata
    globals.css           # ⭐ design tokens + LIQUID-GLASS system + motion + perf
    (app)/
      layout.tsx          # app shell: LivingBackground + Sidebar + Topbar + main
      page.tsx            # Dashboard (/)
      plots|harvests|workers|processing|tasks/page.tsx
  components/
    layout/               # sidebar, topbar, logo (mountain+quetzal mark), living-background
    ui/                   # Card, Badge, Button, StatCard, PageHeader, DataTable, ProgressBar,
                          # Chip, Segmented, Avatar, Tile, EmptyState
    charts/               # BarMini, Donut, TrendLine, StatRing (pure SVG)
    sections/<page>/      # 25 page sections (the real content)
  lib/
    types.ts              # authoritative domain types (the contract)
    brand.ts              # Janson brand constants + palette
    utils.ts              # cn, num, kg, usd, pct, dates, initials
    data/                 # plots, workers, harvests, processing, tasks, activity, weather, trends
```

---

## Design system — Liquid Glass

All defined in `src/app/globals.css`. Performance contract: **real `backdrop-blur` is reserved for floating chrome only**; content cards use a no-blur "glass-lite" so scrolling stays at 60fps.

| Utility | Use |
|---|---|
| `.glass` | True frosted glass **with** backdrop-blur — topbar, overlays only |
| `.glass-card` | Translucent gloss card, **no blur** — the `Card` primitive already uses it |
| `.glass-forest` | Deep-forest glass — the sidebar |
| `.glass-hover` | GPU hover-lift (transform + shadow) — interactive/feature cards |
| `.glass-sheen` | Specular light sweep on hover — one hero surface per view |
| `.stagger` | Children rise in sequence (put on a grid/list container) |
| `.animate-rise` | Single entrance for a wrapper |
| `.perf-contain` / `.cv-auto` | `contain:content` / `content-visibility:auto` for long lists & grids |

A **LivingBackground** (`components/layout/living-background.tsx`) drifts three blurred brand-tinted aurora blobs + a frosted grain behind everything (GPU-only, zero JS). `prefers-reduced-motion` disables all drifts/sheens/entrances.

**Brand:** forest green `#00291D`, coffee brown `#45361F`, cherry `#B5482E`, honey `#C8922E` (text uses `honey-700 #8A5A12` for AA contrast), cream paper. Display type **Quicksand**, body **Inter**.

---

## Status & next steps

**Done**
- ✅ Full structural app — 6 routes, 25 sections, mock-data layer, all charts (built by a 55-agent fan-out; build green, brand + a11y reviewed)
- ✅ System-level **liquid-glass foundation** — glass utilities, living background, glass sidebar/topbar/cards, motion tokens, honey-contrast fix

**Next (planned 51-agent polish pass — not yet run)**
1. **Per-section glass + motion polish** (25 sections + primitives + charts): apply `glass-hover`/`glass-sheen`, `stagger` grids, convert inner tiles/kanban cards to glass, add `cv-auto`/`perf-contain` to tables & boards.
2. **Per-route loading skeletons** (`loading.tsx`) — instant glass shimmer for perceived perf.
3. **Reviewer pass** — visual fidelity, glass consistency, motion, perf budget, a11y/contrast, mobile responsiveness.
4. Browser smoke test + screenshots; optional free Vercel Hobby deploy.

**Guardrails for future sessions**
- Keep it **$0** — no database, no paid services, **no GitHub Actions / CI**.
- Quality bar: world-class, buttery-smooth, performance-optimized liquid glass.
- `src/lib/**` and the finalized shared shell/primitives are the contract — extend, don't fork.
