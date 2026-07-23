# Risk Register

_Opened: 2026-07-23. Severity: High / Medium / Low. Owner: repository owner + AI engineer._
_This register is a living document; add rows as new risks surface, close rows with a dated note._

| ID | Risk | Severity | Likelihood | Impact | Mitigation | Status |
|---|---|:--:|:--:|---|---|---|
| **R-01** | **No automated tests.** Regressions in RLS, scheduling, or bulk operations can ship unnoticed. | High | High | Data corruption / auth bypass reaching prod | Stand up Vitest + targeted RLS/integration tests as calibrated work; require tests for the Work-Item domain and any scheduling/critical-path algorithm (Master Context mandates the latter). | **In progress** — Vitest harness landed (`vitest.config.ts`) with first pure-logic suites (`lib/rate-limit.test.ts`, `lib/color.test.ts`). Coverage grows per feature. |
| **R-02** | **No CI/CD gate.** Push-to-`main` deploys via Vercel with no automated lint/build/test. | High | Medium | Broken build or unsafe change auto-deploys | Add a GitHub Actions workflow: `pnpm lint` + `pnpm build` (+ tests once R-01 lands) as a required check before merge to `main`. | **In progress** — `.github/workflows/ci.yml` runs `pnpm test` on every PR/push. Build+lint+`tsc` jobs pending GH secrets / eslint config (see workflow comment). |
| **R-03** | **`typescript.ignoreBuildErrors: true`** in `next.config.mjs` hides type errors at build time. | Medium | High | Type-unsafe code ships; runtime crashes | Track type errors separately (`tsc --noEmit` in CI); drive the count to zero, then flip the flag off. | Open |
| **R-04** | **Migrations are hand-applied with no runner, no version table, no down-migrations.** | High | Medium | Prod/dev schema drift; irreversible bad migration | Introduce a lightweight applied-migrations ledger; write forward-only migrations with explicit rollback notes; document the apply procedure (see local-setup). | Open |
| **R-05** | **Service-role key** used in three admin routes. A logic slip there bypasses RLS entirely. | High | Low | Cross-user data exposure / privilege escalation | Keep service-role usage confined to `app/api/admin/*`; re-verify each route re-checks the caller is an admin **before** any privileged call; never widen usage without an ADR. | Open (controlled) |
| **R-06** | **In-memory rate limiter** (`lib/rate-limit.ts`) resets on cold start and isn't shared across instances. | Medium | High | Abuse of AI-chat / admin routes under scale | Acceptable now (defense-in-depth behind auth). If abuse appears, move to a shared store (Upstash Redis). | Accepted |
| **R-07** | **Reminder worker is dormant** — `checkDueDateReminders` has no scheduler. | Medium | High | Due-date reminder emails never send | Wire a Vercel Cron (or Supabase scheduled function) to invoke it; add health check for last-run. | Open |
| **R-08** | **No `LICENSE` file.** Repo is `private:true` but undeclared license = ambiguity if ever distributed/open-sourced. | Medium | Low | Legal ambiguity on distribution | **Flag for human legal review** (not a legal conclusion). Add an explicit license before any external distribution. | Open — needs human decision |
| **R-09** | **OSS reference products carry copyleft (AGPL/GPL) terms.** Copying code would create obligations. | Medium | Low | License contamination | Reference-only rule: **copy no code**; study designs, not source. Preserve/attribute any license examined. Flag questions for human legal review. | Controlled |
| **R-10** | **Task attachments stored as base64 in Postgres** (not a bucket). | Medium | Medium | Row bloat, slow queries, no CDN, backup size | Acceptable for small files now; migrate attachments to Supabase Storage when volume grows. | Accepted |
| **R-11** | **Secrets in scope** (Gemini, Resend, Tavily, service-role). Any commit leak is severe. | High | Low | Key compromise, quota theft, data access | Server-side env only; never `NEXT_PUBLIC_`; never commit. `.env.local` git-ignored. Rotate on suspicion. | Controlled |
| **R-12** | **Free-tier ceilings** (Vercel Hobby: exec time/`maxDuration`; Supabase free: rows/storage/connections; Gemini shared daily quota). | Medium | Medium | Feature stalls or 429s under load | Design within limits; AI-chat already handles Gemini 429 gracefully; watch Supabase quotas as tenancy grows. | Accepted |
| **R-13** | **Documentation drift** — e.g. `SETUP.md` says "no Middleware," but session/`/admin` gating lives in `proxy.ts` (Next 16's middleware convention). | Low | Medium | Confusion for future contributors | Corrected in `current-system.md`; refresh `SETUP.md` when next touched. | Open |
| **R-14** | **No feature-flag / module-activation system yet**, but the north-star depends on per-workspace module gating. | Low | High (by design) | Everything ships to everyone; can't calm the default UX | Build module activation as part of tenancy (Prompt 3); until then, keep new advanced surfaces off by default. | Planned |
| **R-15** | **Single maintainer + AI.** Bus factor / review depth. | Medium | Medium | Undetected design or security mistakes | Calibrated 16-section response format proportional to risk; ADRs for structural changes; incremental tests. | Accepted |

## Top priorities before heavy feature work

1. **R-01 / R-02** — a minimal test harness + CI gate (calibrated, not exhaustive) so the larger
   feature prompts (Work-Item domain, view engine, scheduling) can be built safely.
2. **R-04** — a migration ledger + rollback discipline, since every feature prompt adds schema.
3. **R-07** — wire the dormant reminder worker (small, high user-visible value).

None of these were implemented under Prompt 1 (audit-only). They are the recommended first calibrated
tasks once implementation is authorized.
