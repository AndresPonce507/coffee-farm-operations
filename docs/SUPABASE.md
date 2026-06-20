# Database — Supabase (free tier, $0)

The app reads live farm data from a Supabase Postgres database. This is the **only**
hosted service in the project and it runs entirely on Supabase's **free tier** — no
credit card, no CI, no GitHub Actions, no paid infra.

## What's where

| Path | Purpose |
|---|---|
| `supabase/migrations/20260620120000_init.sql` | Schema: enums, 12 tables, RLS (anon read-only), 2 views |
| `supabase/seed.sql` | **Generated** snapshot of `src/lib/data/*` — the seed data |
| `scripts/gen-seed.ts` | Regenerates `seed.sql` from the mock data (`npm run db:gen-seed`) |
| `src/lib/supabase/server.ts` | Read-only anon client (cached per runtime) |
| `src/lib/db/*.ts` | Data-access layer — typed getters the Server Components call |
| `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (gitignored) |

The mock data in `src/lib/data/*` stays as the **source of truth for the seed** — never
deleted. Change the mock data, run `npm run db:gen-seed`, re-apply the seed, and the DB
matches again.

## Design notes

- **Text primary keys** keep the existing ids (`p-tizingal-alto`, `w-06`, `JC-564`) so
  nothing was renumbered.
- **`harvests` / `tasks` are normalized** (real FKs to `plots` + `workers`); the views
  `harvests_view` / `tasks_view` re-join the plot/worker **names** the UI displays.
- **RLS is on, anon is SELECT-only.** The app never writes, so there are no write policies
  and no service-role key in the bundle. The anon key is public by design.
- Dashboard aggregates (`daily_cherries`, `weekly_harvest`, `variety_shares`,
  `season_summary`) are seeded as hand-authored narrative figures, not computed — they're
  bigger than the sampled `harvests` rows on purpose.

## First-time provisioning

```bash
# 1. Log in (one time — opens a browser)
supabase login

# 2. Create a free project (or use an existing one)
supabase projects create janson-coffee --org-id <org> --region <region> --db-password <pw>

# 3. Link this repo to it
supabase link --project-ref <ref>

# 4. Push the schema
supabase db push

# 5. Seed it (uses the project DB connection string)
psql "<connection-string>" -f supabase/seed.sql

# 6. Write .env.local
cp .env.example .env.local
#   NEXT_PUBLIC_SUPABASE_URL  = https://<ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY = (supabase projects api-keys --project-ref <ref>)

# 7. Run it
npm run dev
```

## Reseed an existing project

`seed.sql` truncates every table before re-inserting, so it's idempotent:

```bash
npm run db:gen-seed                       # only if the mock data changed
psql "<connection-string>" -f supabase/seed.sql
```

## ⚠️ Free-tier caveat — auto-pause

Free projects **pause after ~7 days of inactivity**. A paused project returns connection
errors until you un-pause it (one click in the dashboard, ~1 minute). For an idle portfolio
demo this means the live data can go dark between visits — just wake it before showing it.
No keep-alive is wired up (that would need a scheduler, and we keep this CI-free).

Free tier also covers: 500 MB database, up to 2 active projects, 5 GB egress/month — far
beyond what this app needs.
