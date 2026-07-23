# ADR-001 — Extension Strategy for the Unified Product

- **Status:** Accepted
- **Date:** 2026-07-23
- **Decision owner:** Repository owner (confirmed 2026-07-23)
- **Context source:** Master Product Context + the repository audit in
  [`current-system.md`](./current-system.md)

## Context

The Master Product Context was written assuming a **Plane Community Edition** foundation and asks the
audit to choose between four extension strategies. The repository audit established that **there is
no Plane in this repository** — it is a greenfield Next.js 16 + React 19 + Supabase application with
62 hand-applied SQL migrations, RLS-based authorization, no tests, no CI, and no upstream. That fact
reshapes the four options: two of them (“fork Plane”, “Plane + sidecar”) presuppose an upstream we do
not have, so adopting them would mean **importing a large external codebase we currently don’t
depend on at all.**

This ADR evaluates the four canonical options honestly against the *actual* starting point.

## The four options (as posed), reinterpreted for this repo

1. **API-only extension** — Keep an external product (Plane) as the system of record; build only
   against its API. _For us this means adopting Plane first, then integrating._
2. **Shallow Plane fork** — Fork Plane, layer changes on top, track upstream. _Requires importing
   Plane and migrating our existing data/users into it._
3. **Plane + sidecar service** — Run Plane unmodified; add a separate service for the differentiated
   features. _Two systems of record to keep consistent._
4. **Greenfield / continue on the codebase we have** — Build the unified product on the existing
   Next.js + Supabase app, mining OSS products (Plane/OpenProject/Vikunja/Leantime/Taiga) as
   **reference designs only**, copying **no code**. _This is the “greenfield we already have.”_

## Scoring

Scale **1 (worst) – 5 (best)** for this team (solo owner + AI, Vercel Hobby + Supabase free tier,
existing live app with real data). Higher = more favourable.

| Criterion | 1. API-only (adopt Plane) | 2. Shallow fork | 3. Plane + sidecar | 4. Continue on current app |
|---|:--:|:--:|:--:|:--:|
| Delivery effort (higher = less effort) | 2 | 2 | 1 | **5** |
| Upgrade difficulty (higher = easier) | 3 | 1 | 2 | **5** |
| UX control | 2 | 4 | 3 | **5** |
| Authentication complexity (higher = simpler) | 2 | 2 | 1 | **5** |
| Permission complexity (higher = simpler) | 2 | 3 | 1 | **4** |
| Data consistency (higher = safer) | 3 | 4 | 1 | **5** |
| API coverage for our needs | 3 | 4 | 3 | **4** |
| Operational complexity (higher = simpler) | 2 | 2 | 1 | **5** |
| Testing complexity (higher = simpler) | 3 | 2 | 1 | 3 |
| Licensing review exposure (higher = less exposure) | 2 | 1 | 2 | **5** |
| **Total (out of 50)** | **24** | **25** | **16** | **46** |

### Why the Plane-based options score low _here_

- They all begin with a **migration project**: importing Plane and moving existing users, boards,
  tasks, marketing calendar, personal tasks, and AI-chat history into Plane's model — pure cost
  before any new value.
- **Licensing exposure jumps.** Plane's licensing (and its enterprise `ee/` boundary) would need
  formal legal review before we distribute anything; forking maximises that exposure. Today we have
  **zero** copyleft product code. _(Flag for human legal review — not a legal conclusion.)_
- **Two-system consistency** (option 3) is the worst operational trade for a solo maintainer on free
  tiers: two databases, two auth systems, two deploy targets.
- **Auth/permissions** would be **duplicated** — we already have working Supabase Auth + RLS; Plane
  brings its own, and reconciling them is exactly the "duplicate existing authentication" trap the
  Master Context warns against.

### Where option 4 is genuinely weaker (and must be mitigated)

- **Testing complexity (3/5):** we start from **no test harness**, so we don't inherit anyone's test
  suite. Mitigation: the agreed "calibrated" process introduces Vitest + targeted integration/RLS
  tests incrementally, starting with the canonical Work-Item domain and scheduling/critical-path
  algorithms (which the Master Context explicitly says must be newly tested, not assumed inherited).
- **We build more ourselves** (views engine, Gantt, automation). Mitigation: OSS products are mined
  as **reference designs**; the roadmap in `FEATURES.md` sequences the build so we never carry a
  half-finished parity effort.

## Decision

**Adopt Option 4 — continue building the unified product on the existing Next.js 16 + Supabase
application.** Do **not** fork, adopt, or run Plane. Use Plane/OpenProject/Vikunja/Leantime/Taiga
purely as reference designs; copy no code and preserve every upstream license if any snippet is ever
studied.

This matches the four owner rulings already recorded (build on existing app; enterprise items are
north-star/design-for-later; hosted SaaS for now; calibrated process) and the north-star information
architecture (Org→Workspace→Team→Portfolio→Initiative→Project→Epic/Module→Work Item→Subtask with one
configurable Work-Item domain).

## Consequences

**Positive**
- No migration tax; the live app keeps working while we extend it.
- One auth system, one RLS authorization model, one deploy target, one database.
- Full UX control for the marketing/content-execution wedge and the data-native AI.
- Minimal licensing exposure; we control the whole tree.

**Negative / obligations**
- We own the full build cost of advanced modules (views, Gantt, automation, governance).
- We must **stand up a test harness** and CI as first-class calibrated work — this is now a tracked
  obligation (risk register R-01/R-02), not an afterthought.
- Enterprise features must be **designed-for-later in the data model** so we don't repaint ourselves
  into a corner (custom-fields engine first = "one Work-Item domain with configurable types").

## Guardrails carried forward into every subsequent prompt

- All data access goes through the **Supabase session client** so RLS applies; the service role is
  used **only** in the three gated admin user-management routes.
- Schema changes are **new numbered migrations** in `scripts/` (next is `063_*`), applied by hand.
- Ship to `main` via **small sliced PRs**; no `Co-Authored-By: Claude` trailers.
- **No feature implementation** was performed under this prompt.
