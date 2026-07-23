# Upstream Boundary

_Audit date: 2026-07-23._

## Summary

**There is no upstream.** This repository is a first-party, greenfield **Next.js 16 + Supabase**
application. It is **not** a fork of Plane (or OpenProject, Vikunja, Leantime, Taiga, or any other
project-management product). Therefore the classic "upstream boundary" — the line between vendored
third-party code we track and our own overlay — **does not exist as a code boundary here.** Every
line of product code in the tree is ours to change freely.

Evidence:
- Single git remote `origin → github.com/VanshajPoonia/projectmanagementatlas.git`; no `upstream`
  remote, no vendored product submodule.
- `package.json` name is `my-v0-project`; dependencies are ordinary npm libraries, not a forked
  application.
- No Plane/Django/Python service, no `ee/` enterprise directory, no upstream `CHANGELOG`.

## What that means in practice

| Question the brief asked | Answer |
|---|---|
| Plane version / upstream commit | N/A — no Plane present |
| How do we take upstream updates? | N/A — nothing to rebase onto |
| Which files may we modify vs. must we leave pristine? | **All files are modifiable**; none are vendored-pristine |
| Merge-conflict risk with upstream | None |

## The real boundaries we _do_ manage

Since there is no upstream, the boundaries worth governing are internal/external **dependencies**:

1. **Third-party npm dependencies** (Radix, Supabase SDKs, recharts, gsap, etc.) — upgraded via pnpm;
   treated as libraries, never forked in-tree. `pnpm-workspace.yaml` pins two native postinstalls
   (`@tailwindcss/oxide`, `sharp`) and a few security `overrides`.
2. **Supabase platform** (Auth, Postgres, Storage, Realtime) — an external managed dependency. Our
   "boundary" with it is the SQL migration set in `scripts/` and the RLS policies; we own the schema,
   Supabase owns the runtime.
3. **External APIs** — Gemini (AI chat), Resend (email), Tavily (web search for AI). Keys are
   server-side env only; these are integration boundaries, not code we vendor.
4. **OSS reference products** — Plane/OpenProject/Vikunja/Leantime/Taiga are studied for **design
   inspiration only**. The hard rule (from the Master Product Context): **copy no code**, preserve
   and attribute any license if a snippet is ever examined, and **flag every licensing question for
   human legal review** rather than asserting a legal conclusion. Keeping these as reference-only is
   what keeps our licensing exposure at zero (see ADR-001).

## Boundary rule for future work

Because we have no upstream to protect, the discipline shifts from "don't touch vendored files" to:

- **Keep the schema forward-only** — new numbered migrations, never edit historical ones.
- **Keep RLS the source of truth** — all access via the session client; the service role stays
  confined to the three admin user-management routes.
- **Keep external integrations behind `lib/` wrappers** (`lib/ai-chat.ts`, `lib/email.ts`, …) so a
  provider swap never leaks across the codebase.

See [`adr-001-extension-strategy.md`](./adr-001-extension-strategy.md) for why we are not adopting an
upstream.
