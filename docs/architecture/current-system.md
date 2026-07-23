# Current System — Architecture Audit

_Audit date: 2026-07-23. Source: direct inspection of the repository at `main`, not product documentation._

> **Headline finding:** This repository is **not** a Plane deployment or a Plane fork. It is a
> greenfield **Next.js 16 App Router + Supabase** application (v0-scaffolded, package name
> `my-v0-project`). Every "Plane version / upstream commit" style question in the audit brief is
> **N/A** — see [`upstream-boundary.md`](./upstream-boundary.md). The audit below records what is
> actually present in code.

## 1. Stack summary

| Layer | Technology | Evidence |
|---|---|---|
| Framework | Next.js **16.2.9** (App Router) | `package.json`, `app/` |
| UI runtime | React **19.2.0**, React DOM 19.2.0 | `package.json` |
| Language | TypeScript 5 (`ignoreBuildErrors: true`) | `next.config.mjs` |
| Styling | Tailwind **v4** (`@tailwindcss/postcss`, oxide engine), `tailwindcss-animate`, `tw-animate-css` | `package.json`, `pnpm-workspace.yaml` |
| Components | Radix UI primitives + shadcn-style wrappers (`components/ui`), `cmdk`, `vaul`, `sonner` | `package.json`, `components.json` |
| Drag & drop | `@hello-pangea/dnd` 18 | `package.json` |
| Charts | `recharts` 2.15 | `package.json` |
| Forms/validation | `react-hook-form` + `zod` + `@hookform/resolvers` | `package.json` |
| Animation | `gsap` | `package.json` |
| Package manager | **pnpm** (workspace file present) | `pnpm-workspace.yaml`, `pnpm-lock.yaml` |
| Hosting | **Vercel** (Hobby/free tier) | `.vercel/`, deployment history |

## 2. Frontend applications

Single Next.js App-Router app. There is **no separate frontend SPA**, no monorepo of apps. Route groups:

- `app/login`, `app/signup` — auth pages (public signup is disabled in practice; see §6).
- `app/dashboard`, `app/dashboard/board/[id]` — regular-user work area (Kanban board view).
- `app/admin`, `app/admin/board/[id]`, `app/admin/super-admin` — admin + super-admin management.
- `app/api/**` — server routes (see §7).

Component library under `components/` (board, chat, ai-chat, ui, etc.). Design tokens and the visual
system are documented in the repo-root `DESIGN.md`.

## 3. Backend applications

No standalone backend service. "Backend" = Next.js **Route Handlers** (`app/api/**/route.ts`) plus
**Server Components / server actions** that talk to Supabase directly. There is no Django/Python
service, no separate API gateway, no gRPC — again confirming this is not Plane.

## 4. Database

- **Supabase Postgres.** Schema is defined by **62 hand-numbered SQL migrations** in `scripts/`
  (`001_initial_schema.sql` … `062_marketing_missed_status.sql`).
- Migrations are **applied by hand** to the hosted Supabase project (there is no migration runner in
  CI). Some scripts are data operations / one-off imports (e.g. `013`–`029`, `040`), not just DDL.
- **Row Level Security is enabled on every table.** Several migrations install `private`-schema
  `SECURITY DEFINER` helper functions as an RLS chokepoint (e.g. `035`, `038`, `047`, `051`, `052`,
  `060`, `061`) to avoid recursive-policy problems and centralise authorization logic.
- Core tables: `profiles`, `companies`, `boards`, `columns`, `tasks`, `task_assignees`,
  `task_statuses`, `task_attachments`, `task_comments`, `task_links`, `task_activity`, `tags`,
  `task_tags`, `chat_messages`, `chat_read_state`, `bookmarks`, `personal_tasks`,
  `marketing_calendar_items`, `marketing_channels`, `notification_preferences`, `ai_chat_messages`.
- The **legacy `allowed_emails`** table was dropped in `044`.

See [`domain-map.md`](./domain-map.md) for the entity model.

## 5. Authentication

- **Supabase Auth** via `@supabase/ssr` (0.8.0). Two client factories:
  - `lib/supabase/server.ts` — cookie-bound server client (anon key + user session cookies).
  - `lib/supabase/client.ts` — memoised browser client (anon key).
- Session refresh happens in **`proxy.ts`** at the repo root. In Next.js 16 the middleware file
  convention is `proxy.ts`; this project uses it to refresh the Supabase session and to gate
  `/admin` paths by `profiles.role`. (SETUP.md's older claim "there is no Middleware" refers to the
  pre-16 `middleware.ts` name — the equivalent now lives in `proxy.ts`. **Documentation mismatch
  logged** in [`risk-register.md`](./risk-register.md).)
- **Public self-service signup is effectively disabled**: accounts are created by admins through the
  admin API. `app/signup` exists but org policy is admin-provisioned users.

## 6. Authorization

- **Three roles**: `user`, `admin`, `super_admin` (`profiles.role`; super-admin added in `047`,
  role columns locked down in `048`).
- **Primary enforcement is RLS in Postgres**, reached through the user's session client so
  `auth.uid()` is always the acting user. This is the security backbone.
- **Per-page server guards**: each protected page calls `auth.getUser()` and redirects if
  unauthorized (`app/admin/*`, `app/dashboard/*`).
- **`proxy.ts`** adds a coarse `/admin` gate as defense-in-depth.
- **Service-role key is used in exactly three places**, all admin-only user-management routes:
  `app/api/admin/{create,update,delete}-user/route.ts`. These are the deliberate, gated exceptions
  to the "always use the session client" rule (they must call `auth.admin.*`). No other code path
  bypasses RLS.

## 7. API routes

Only four route handlers exist:

| Route | Purpose | Auth model |
|---|---|---|
| `app/api/ai-chat/route.ts` | Gemini function-calling chat (`maxDuration=60`), rate-limited | Session user |
| `app/api/admin/create-user/route.ts` | Provision a user | Admin + **service role** |
| `app/api/admin/update-user/route.ts` | Edit a user | Admin + **service role** |
| `app/api/admin/delete-user/route.ts` | Remove a user | Admin + **service role** |

Everything else is done from Server Components / client components against Supabase directly. There
is **no public REST/GraphQL API surface** and no versioned external API.

## 8. Webhooks

**None.** No inbound webhook receivers, no outbound webhook dispatch.

## 9. Background workers

**None as a running system.** `lib/reminder-service.ts` (`checkDueDateReminders`) exists and is
designed "to be called via a cron job," but there is **no Vercel Cron entry, no scheduler, and no
invoker wired up**. Effectively dormant. Logged as a gap in the risk register.

## 10. Scheduled jobs

**None configured.** No `vercel.json` cron block, no `.github` scheduled workflows.

## 11. Cache

**No shared cache.** The only caching is `lib/rate-limit.ts`, an **in-memory sliding window** that
is per-serverless-instance and resets on cold start (its own comment flags this and suggests Upstash
Redis if a durable limit is ever needed). No Redis/Memcached is provisioned.

## 12. Search

**No dedicated search service** (no Elasticsearch/Meilisearch/Typesense/pg_trgm indexes wired to a
search UI). Lookups are direct Postgres queries / client-side filtering.

## 13. File storage

- **Supabase Storage** bucket `chat-attachments` (created in `002`) for chat images, with
  per-user-folder RLS policies.
- **Task attachments do NOT use a bucket** — they are stored as **size-capped base64** in the DB
  with a server-enforced size check (`043`). (Trade-off: simple, but bloats rows / not CDN-served.)

## 14. Email

**Resend** (`resend` 6.x) via `lib/email.ts`. Requires `RESEND_API_KEY` + `EMAIL_FROM`. Used for
task-assignment notifications and the (currently un-scheduled) due-date reminder.

## 15. Real-time collaboration

**Supabase Realtime** postgres-changes subscriptions in three places: `components/chat/chat-panel.tsx`,
`components/chat/chat-unread-badge.tsx`, `components/board/board-view.tsx`. No OT/CRDT
co-editing; realtime is row-change fan-out only.

## 16. Feature flags

**None.** No flag system, no per-workspace module toggles yet. (The Master Product Context's
"module activation" concept is unbuilt — a Phase-1+ item, not present today.)

## 17. Existing tests

**None.** No `vitest`/`jest`/`playwright` config, no `*.test.ts` / `*.spec.ts` files. `package.json`
has no `test` script. This is the single biggest engineering-hygiene gap and is why the agreed
process is "calibrated" — tests are introduced incrementally alongside risky features.

## 18. CI/CD

- **No `.github/` workflows.** No CI, no automated lint/build/test gate.
- Deployment is **Vercel's Git integration** (push to `main` → build/deploy). `.vercel/` present.
- Quality currently rests on local `pnpm lint` / `pnpm build` and review discipline.

## 19. Docker & local development

- **No Dockerfile, no docker-compose.** Local dev is `pnpm install` + `pnpm dev` against the
  **hosted** Supabase project (there is no local Postgres/containerised stack).
- See [`../development/local-setup.md`](../development/local-setup.md).

## 20. Existing custom code (all of it is custom)

Because there is no upstream, **100% of the code is first-party**. Notable modules in `lib/`:
`ai-chat.ts` + `ai-chat-tools.ts` (Gemini function-calling, data-aware), `assignees.ts`,
`task-activity.ts`, `task-status.ts` / `use-task-statuses.ts`, `work-next.ts`, `rate-limit.ts`,
`reminder-service.ts`, `email.ts`, `color.ts`, `display-text.ts`.

## 21. Existing migrations

62 numbered SQL files in `scripts/` (§4). They mix DDL, RLS policy, `SECURITY DEFINER` functions,
and one-off data imports. **No down-migrations / rollback scripts exist.** Numbering is the only
ordering contract; there is no schema-version table.

## 22. Licensing files

- **No `LICENSE` / `COPYING` file** at the repo root. The project is `"private": true` in
  `package.json`.
- All dependencies are permissively licensed npm packages (MIT/ISC/Apache-style) pulled via pnpm;
  there is **no copyleft (AGPL/GPL) product code** in the tree because nothing was forked.
- **Action for human legal review** (do not treat as a conclusion): if the product is ever
  distributed or open-sourced, add an explicit `LICENSE`. Logged in the risk register.

## 23. What exists vs. what the audit brief assumed

| Brief assumed (Plane-shaped) | Reality |
|---|---|
| Plane version / upstream commit | N/A — not Plane, no upstream |
| Separate frontend + backend apps | Single Next.js app |
| Django/Python API, DRF | Next Route Handlers + Supabase |
| Redis cache, Celery queue, workers | None provisioned |
| Elasticsearch/search service | None |
| Docker/compose local stack | None (hosted Supabase) |
| CI/CD pipelines | None (Vercel git deploy only) |
| Existing test suite | None |

This table is the crux of the extension decision — see [`adr-001-extension-strategy.md`](./adr-001-extension-strategy.md).
