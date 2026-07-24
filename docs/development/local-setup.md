# Local Development Setup

_Audit date: 2026-07-23. This is the documented, reproducible way to launch the system locally._

> **Architecture note.** There is **no Docker/compose stack and no local Postgres.** Local
> development runs the Next.js app against the **hosted Supabase project**. That is intentional for a
> hosted-SaaS-for-now product (see ADR-001). The "important services" this app depends on are:
> Supabase (Postgres + Auth + Storage + Realtime), and the external APIs Gemini/Resend/Tavily.
> Cache, queue, dedicated search, and background workers are **not provisioned** — the health check
> reports those as `N/A` by design (see [`../architecture/current-system.md`](../architecture/current-system.md)).

## 1. Prerequisites

- **Node.js ≥ 20** (Next 16 / React 19).
- **pnpm** (`corepack enable` or `npm i -g pnpm`).
- Access to the project's **Supabase** project and the relevant API keys.

## 2. Install

```bash
pnpm install
```

`pnpm-workspace.yaml` allows the `@tailwindcss/oxide` and `sharp` postinstalls (native binaries). If
`pnpm install` ever exits 1 on the `allowBuilds` block, that file already pins them to `true`.

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill in values. Full set the app expects:

```bash
# --- Supabase (client-visible; anon key is safe to expose) ---
NEXT_PUBLIC_SUPABASE_URL=            # https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # anon/public key

# --- Supabase (SERVER ONLY — never NEXT_PUBLIC_, never commit) ---
SUPABASE_SERVICE_ROLE_KEY=           # used ONLY by app/api/admin/* user-management routes

# --- Email (Resend) ---
RESEND_API_KEY=
EMAIL_FROM="Project Manager <notifications@yourdomain.com>"

# --- AI chat (Gemini) ---
GEMINI_API_KEY=
# Optional model overrides (see lib/ai-chat.ts):
# GEMINI_MODEL=
# GEMINI_MULTIMODAL_MODEL=

# --- AI web search (Tavily), if web mode is enabled ---
TAVILY_API_KEY=
```

**Secret hygiene:** everything except the two `NEXT_PUBLIC_*` values is server-only. `.env.local` is
git-ignored. Never prefix a secret with `NEXT_PUBLIC_`; never commit keys (risk R-11).

## 4. Database

> ⛔ **On the `platform` branch, ignore the `vercel env pull` instructions below.** This worktree's
> `.env.local` is deliberately repointed at a separate dev Supabase project (see `CLAUDE.md`) so
> destructive tenancy migrations can't reach production. Running `vercel env pull` here would
> silently overwrite it with production credentials and defeat that safeguard entirely — there is
> no `.vercel/` link in this worktree on purpose. Never run `vercel env pull` or `vercel link` here.
> Use `pnpm migrate` (see `scripts/migrate.mjs`), not raw `psql` — it enforces the same dev-only
> guard and is the source of truth for what's been applied (`public.applied_migrations`).

The hosted Supabase project already has the schema applied. To reproduce it on a fresh Supabase
project, apply `scripts/0*.sql` **in numeric order** (`001` → `062`) via the Supabase SQL editor or
`psql`. There is no migration runner — ordering by filename is the contract (risk R-04). *(This
paragraph describes the `main` branch's process — outdated for `platform`, see the warning above.)*

To apply/inspect against prod (main branch only — NOT this worktree), the established path is:
```bash
vercel env pull .env.local           # pull current env
psql "$POSTGRES_URL_NON_POOLING"     # run SQL on the hosted DB
```
New schema changes go in the **next numbered file** (`064_*.sql` on `platform`), forward-only.

## 5. Run

```bash
pnpm dev        # Next.js dev server (Turbopack) → http://localhost:3000
pnpm build      # production build
pnpm start      # serve the production build
pnpm lint       # eslint
```

First admin: create a user in Supabase Auth, then set that row's `profiles.role = 'admin'` (see
`SETUP.md`). Public signup is disabled; admins provision users from `/admin`.

## 6. Health check (verify important services)

Run the documented health check to confirm connectivity before/while developing:

```bash
pnpm dlx tsx scripts/healthcheck.mjs        # or: node scripts/healthcheck.mjs
```

It reads `.env.local` and reports each dependency the audit brief asks about:

| Service | What it checks | Applicable here? |
|---|---|---|
| Database | Supabase REST reachable + a trivial `companies` count (RLS-safe, publicly viewable) | ✅ |
| Object storage | Supabase Storage lists the `chat-attachments` bucket | ✅ |
| API health | `GET /api/health` on `HEALTHCHECK_BASE_URL` (default `http://localhost:3000`) if a server is running | ✅ (optional) |
| Email | Presence of `RESEND_API_KEY` + `EMAIL_FROM` (no test send) | ✅ (config only) |
| AI | Presence of `GEMINI_API_KEY` | ✅ (config only) |
| Cache | — | **N/A** (in-memory only, not provisioned) |
| Queue | — | **N/A** (no queue) |
| Worker | Reports the reminder worker as **dormant/unscheduled** (risk R-07) | ⚠️ dormant |
| Search | — | **N/A** (no dedicated search service) |

The script exits non-zero if a service marked ✅ fails, and prints `N/A` (not a failure) for services
this architecture doesn't provision — an honest reflection of the current system rather than the
Plane-shaped assumptions in the brief.

## 7. Definition-of-done for local launch (met)

- [x] The app launches locally from these instructions (`pnpm install` → `.env.local` → `pnpm dev`).
- [x] All important services are identified (Supabase Postgres/Auth/Storage/Realtime; Resend; Gemini;
      Tavily) and the non-existent ones (cache/queue/search/worker) are called out explicitly.
- [x] The upstream boundary is explicit — there is none (see `upstream-boundary.md`).
- [x] A single documented command verifies connectivity (`scripts/healthcheck.mjs`).
