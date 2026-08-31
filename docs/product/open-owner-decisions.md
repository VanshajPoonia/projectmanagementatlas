# Open owner decisions

**This list now lives in the product: Super Admin → Decisions.**

It was a markdown file for one day, and that was a mistake worth naming rather than quietly
deleting. A hand-maintained file is a copy of a state nobody is obliged to update: the moment
somebody resolves a decision, the file still says "waiting on you", and nothing distinguishes a
live decision from a stale sentence. That is the same defect this codebase keeps paying for, and
it is exactly why `app_modules` is a table rather than a constant.

So the decisions are rows now (`public.owner_decisions`, migration `128`), and the screen is the
only place to read or change them.

## What moved

- **Where:** `/admin/super-admin` → **Decisions** tab.
- **Who:** super admins only. Every policy is `private.is_super_admin_user()`, so plain admins
  (Tim, Kogan, Mendy) do not see it. ⚠️ Note that `private.is_admin_user()` would have been
  wrong and would have looked right in review, since it is true for both tiers. `pnpm
  check:decisions` has a plain-admin control case for exactly that.
- **What you can do:** add one, mark it decided, mark it not-doing, reopen it, delete it.
- **Closing one needs a note**, enforced by a trigger rather than by the dialog, because six
  months from now the note is the only record of why. Reopening clears the note, the resolver
  and the timestamp, so a reopened decision never carries an outcome that is no longer true.
- **The closure cannot be forged.** `resolved_by` and `resolved_at` are stamped by the database
  on update, so the log cannot be made to say somebody else made a call they did not make.

## Deprovisioning, decided when the table was created

`created_by` and `resolved_by` are `ON DELETE SET NULL`: never cascade, never reassigned. A
decision is org furniture, not personal work, so deleting the person who recorded it must not
destroy the record, and reassigning it would make the row claim somebody else made the call.
Losing the attribution is the correct and only loss, and
`app/api/admin/delete-user/route.ts` therefore needs no change for this table.

Gate: `pnpm check:decisions` (21 checks, real RLS), plus `lib/owner-decisions.test.ts`.
