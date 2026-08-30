// Migrations that are deliberately NOT applied, and why.
//
// WHY THIS FILE EXISTS
// Before it, a held-back migration was indistinguishable from one nobody had got round to:
// `pnpm migrate:status` against prod reported `pending: 1` forever. Two things follow from
// that, and the second is the dangerous one.
//
//   1. A permanently-nonzero pending count destroys the signal. The day a genuine second
//      migration goes unapplied it reads `pending: 2`, which a tired reader dismisses as
//      "yeah, that's the known one". CLAUDE.md admits to going stale about migration numbers
//      three times; a status command that always says the same thing is how that happens.
//
//   2. A bare `pnpm migrate --allow-prod` applied it as a side effect. The only thing standing
//      between production and a held-back trigger was somebody remembering to type
//      `--only=NNN`. That is a rule enforced by memory, which is not a rule.
//
// So a hold is now a first-class state: excluded from `pending`, reported separately with its
// reason, and refused by --apply and --baseline alike unless the operator names it with
// --release-hold=NNN. Releasing one is still an OWNER decision under the override path in
// CLAUDE.md ("⚠️ The owner-override path"), and the flag is deliberately not something you
// would type by accident.
//
// Removing an entry from this list is the same decision as applying the file. Do not tidy it.

export const HELD_MIGRATIONS = [
  {
    file: '125_wip_enforcement.sql',
    since: '2026-08-29',
    reason:
      'Puts a trigger on `tasks`, so it runs on every task move on every board in the product. ' +
      'Not --allow-prod eligible on this repo\'s own rule. It is a no-op on 100% of writes the ' +
      'day it lands (no column carries a wip_limit, no board has agile settings, the module is ' +
      'off), so applying it buys nothing today and costs a rule. Unlike 113 and 118 - the two ' +
      'prior owner overrides - no shipped code depends on it: the WIP badge and settings dialog ' +
      'read wip_enforcement_installed() (126) and honestly say "warning only" where it is absent.',
    releaseNeeds:
      'An owner decision, a verified backup, and --only=125 --allow-prod --release-hold=125. ' +
      'Read scripts/125_wip_enforcement.sql\'s header first: it states the risk in full.',
  },
]

const num = (f) => Number.parseInt(String(f).match(/^(\d+)/)?.[1] ?? '-1', 10)

export const heldByFile = new Map(HELD_MIGRATIONS.map((h) => [h.file, h]))
export const isHeld = (file) => heldByFile.has(file)
export const heldByNumber = (n) => HELD_MIGRATIONS.find((h) => num(h.file) === n)

// The whole rule, in one pure function so it can be tested without a database.
// `pendingFiles` is everything unapplied on THIS database; `released` is the set of numbers
// named with --release-hold. Returns the queue to run and the holds to report.
export function splitHeld(pendingFiles, released = new Set()) {
  const heldFiles = pendingFiles.filter((f) => isHeld(f) && !released.has(num(f)))
  const heldSet = new Set(heldFiles)
  return { pending: pendingFiles.filter((f) => !heldSet.has(f)), held: heldFiles }
}
