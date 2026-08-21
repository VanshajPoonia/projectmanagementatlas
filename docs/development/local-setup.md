# Local Development Setup

_Audit date: 2026-07-23. Database and run sections revised 2026-08-21._
_This is the documented, reproducible way to launch the system locally._

> **Architecture note.** There is **no Docker/compose stack and no local Postgres.** Local
> development runs the Next.js app against the **hosted Supabase project**. That is intentional for a
> hosted-SaaS-for-now product (see ADR-001). The "important services" this app depends on are:
> Supabase (Postgres + Auth + Storage + Realtime), and the external APIs Gemini/Resend/Tavily.
> Cache, queue, dedicated search, and background workers are **not provisioned** - the health check
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

# --- Supabase (SERVER ONLY - never NEXT_PUBLIC_, never commit) ---
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

# --- Postgres (SERVER ONLY - used by scripts/migrate.mjs and scripts/guard-db.mjs,
#     never by the app itself). See "Connecting with psql directly" in section 4:
#     this must be the regional pooler URL on port 5432, not db.<ref>.supabase.co. ---
POSTGRES_URL_NON_POOLING=
```

**Secret hygiene:** everything except the two `NEXT_PUBLIC_*` values is server-only. `.env.local` is
git-ignored. Never prefix a secret with `NEXT_PUBLIC_`; never commit keys (risk R-11).

## 4. Database

> ⛔ **Never run `vercel env pull` or `vercel link` in this folder.** `.env.local` points at a
> **separate dev Supabase project** (a full clone of production) so that migrations and local dev
> cannot reach the live database. `vercel env pull` would overwrite it with production credentials
> and defeat that safeguard entirely; there is no `.vercel/` link here on purpose.

**There is a migration runner. Use it, not raw `psql`.** `scripts/migrate.mjs` applies
`scripts/NNN_*.sql` in numeric order and records each one in `public.applied_migrations`, which is
the only source of truth for what has run where. It refuses to open a connection until
`scripts/guard-db.mjs` has confirmed the target.

```bash
pnpm guard             # which project does the current environment resolve to?
pnpm migrate:status    # applied / pending counts for that target
pnpm migrate           # apply everything pending (dev sandbox)
pnpm migrate --only=110 --allow-prod   # one file, against PRODUCTION, deliberately
```

Dev is always allowed. **Production requires the explicit `--allow-prod` flag** and prints an
unmissable banner. Only additive, non-destructive migrations may ever use it: anything that
rewrites an RLS policy or changes a constraint on an existing table is destructive until proven
otherwise, and stays on the dev sandbox. New schema changes go in the **next numbered file**,
forward-only. See `CLAUDE.md` for the full guardrail and the per-migration history.

### Connecting with `psql` directly

Both `db.<ref>.supabase.co` hosts are **IPv6-only**, and a machine without an IPv6 route cannot
reach them. The failure is misleading: libpq reports
`could not translate host name ... nodename nor servname provided`, which looks like DNS but is not
(`dig +short db.<ref>.supabase.co AAAA` returns the address fine). Use the regional Supavisor
pooler over IPv4 instead, on **port 5432 (session mode)**:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Port **6543 is transaction mode and will break migrations** - these files own their own
`BEGIN; ... COMMIT;`, which transaction pooling does not hold across statements. If the pooler
answers `(ENOTFOUND) tenant/user postgres.<ref> not found`, that means the **wrong region**, not
that pooling is disabled. The guard understands both URL shapes, so switching to a pooler URL keeps
the dev/prod allowlist intact.

## 5. Run

```bash
pnpm dev        # Next.js dev server (Turbopack) → http://localhost:3000
pnpm test       # vitest unit suite (also what CI runs)
pnpm build      # production build
pnpm start      # serve the production build
pnpm lint       # ⚠️ currently fails: no eslint flat config exists (see KNOWN-ISSUES.md)
```

⚠️ **`pnpm build` and `pnpm start` talk to PRODUCTION.** Next loads `.env.$(NODE_ENV).local` ahead
of `.env.local`, and this repo has a `.env.production.local` holding prod credentials, so a
production build bakes prod's Supabase URL into the client bundle. `pnpm dev` is unaffected and
uses the dev sandbox. See `CLAUDE.md` before browser-testing against `pnpm start`.

Beyond the unit suite, each permission-sensitive feature has a real-RLS harness run against the dev
sandbox (`pnpm check:access-matrix`, `check:board-roles`, `check:crm`, and ~30 more; see
`package.json`). A passing harness proves the database refuses what it should - it does **not**
prove a human can reach the feature, which is a distinction this repo has been bitten by.

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
| Cache | - | **N/A** (in-memory only, not provisioned) |
| Queue | - | **N/A** (no queue) |
| Worker | Reports the reminder worker as **dormant/unscheduled** (risk R-07) | ⚠️ dormant |
| Search | - | **N/A** (no dedicated search service) |

The script exits non-zero if a service marked ✅ fails, and prints `N/A` (not a failure) for services
this architecture doesn't provision - an honest reflection of the current system rather than the
Plane-shaped assumptions in the brief.

## 7. Definition-of-done for local launch (met)

- [x] The app launches locally from these instructions (`pnpm install` → `.env.local` → `pnpm dev`).
- [x] All important services are identified (Supabase Postgres/Auth/Storage/Realtime; Resend; Gemini;
      Tavily) and the non-existent ones (cache/queue/search/worker) are called out explicitly.
- [x] The upstream boundary is explicit - there is none (see `upstream-boundary.md`).
- [x] A single documented command verifies connectivity (`scripts/healthcheck.mjs`).
