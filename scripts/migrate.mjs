#!/usr/bin/env node
// Migration runner - Phase 0 safety net.
//
// The repo has 62 hand-numbered SQL files in scripts/ that were applied to production
// by hand, with no record of what ran where. That is exactly where a tenancy migration
// mistake would leak one company's data to another and only surface via a customer.
// This runner gives us a durable record (public.applied_migrations) and applies pending
// migrations in order, each file managing its own BEGIN/COMMIT (see scripts/ convention).
//
// Reads POSTGRES_URL_NON_POOLING from the environment. Run via the package scripts, e.g.:
//   pnpm migrate:status     - list applied vs pending
//   pnpm migrate:baseline   - mark all existing files as applied WITHOUT running them
//                             (for a DB already at that schema, e.g. the seeded dev clone)
//   pnpm migrate            - apply all pending migrations in order
//
// It never DROPs or rewrites; the only object it creates itself is the tracking table.

import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertMigrationTarget } from './guard-db.mjs'
import { HELD_MIGRATIONS, heldByNumber, splitHeld } from './held-migrations.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

const DB_URL = process.env.POSTGRES_URL_NON_POOLING
if (!DB_URL) {
  console.error('POSTGRES_URL_NON_POOLING is not set. Run via pnpm migrate* (loads .env.local).')
  process.exit(1)
}

// CLI: [--status | --baseline | --apply] [--allow-prod] [--through=NNN] [--only=NNN,NNN]
//   --allow-prod   deliberate opt-in required to target the live database
//   --through=NNN  with --baseline, record only files numbered <= NNN (the rest stay pending),
//                  which is how a DB that is already at migration NNN gets adopted by the runner
//                  without marking later, genuinely-unapplied files as done.
//   --only=NNN,NNN with --apply, run only these numbered migrations and leave every other
//                  pending file pending. Needed when an earlier pending file is destructive and
//                  still awaiting sign-off, but a later additive one must ship to fix a live bug.
//                  Skipping a predecessor is the caller's responsibility - check the dependency.
//   --release-hold=NNN
//                  required to apply (or baseline) a migration listed in held-migrations.mjs.
//                  A hold is a recorded decision, not a backlog item: without this flag a held
//                  file is excluded from `pending` entirely, so no bare `pnpm migrate
//                  --allow-prod` can sweep it up on the way to a later migration.
const ARGS = process.argv.slice(2)
const ALLOW_PROD = ARGS.includes('--allow-prod')
const throughArg = ARGS.find((a) => a.startsWith('--through='))
const THROUGH = throughArg ? Number.parseInt(throughArg.split('=')[1], 10) : null
const onlyArg = ARGS.find((a) => a.startsWith('--only='))
const ONLY = onlyArg
  ? new Set(onlyArg.split('=')[1].split(',').map((s) => Number.parseInt(s.trim(), 10)))
  : null
const releaseArgs = ARGS.filter((a) => a.startsWith('--release-hold='))
const RELEASED = new Set(
  releaseArgs.flatMap((a) => a.split('=')[1].split(',').map((s) => Number.parseInt(s.trim(), 10)))
)
const mode = ARGS.find((a) => ['--status', '--baseline', '--apply'].includes(a)) || '--apply'

// Naming a hold that does not exist is a typo, and a typo here reads as "released" to the
// person who typed it. Refuse rather than proceed with the hold still in place.
for (const n of RELEASED) {
  if (!heldByNumber(n)) {
    console.error(`--release-hold=${n} names a migration that is not held. Nothing to release.`)
    process.exit(1)
  }
}

// Zero-padded numeric prefix of a migration filename, e.g. 076_foo.sql -> 76.
const prefixNum = (f) => Number.parseInt(f.match(/^(\d+)/)[1], 10)

// Dev is always allowed; prod requires --allow-prod. Aborts before any psql connection.
assertMigrationTarget({ allowProd: ALLOW_PROD })

// libpq/psql is often not on the default PATH on macOS - locate it.
function findPsql() {
  const candidates = [
    'psql',
    '/opt/homebrew/opt/libpq/bin/psql',
    '/usr/local/opt/libpq/bin/psql',
    '/opt/homebrew/bin/psql',
    '/usr/bin/psql',
  ]
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c } catch { /* keep looking */ }
  }
  console.error('psql not found. Install libpq: brew install libpq')
  process.exit(1)
}
const PSQL = findPsql()

// Every call runs with ON_ERROR_STOP so a bad statement aborts with a non-zero exit.
function psql(args) {
  return execFileSync(PSQL, [DB_URL, '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
}

function ensureTable() {
  psql(['-q', '-c', `
    create table if not exists public.applied_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
    -- Keep this internal table out of the public API surface. The runner connects as the
    -- table owner (postgres), which bypasses RLS, so the runner is unaffected.
    alter table public.applied_migrations enable row level security;
  `])
}

function appliedSet() {
  const out = psql(['-tAq', '-c', 'select filename from public.applied_migrations'])
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))
}

function migrationFiles() {
  // Zero-padded numeric prefixes sort lexically in numeric order.
  return readdirSync(SCRIPTS_DIR).filter((f) => /^\d{3,}.*\.sql$/.test(f)).sort()
}

// Short content hash so we can later notice if an already-applied file was edited.
function checksum(file) {
  return createHash('sha256').update(readFileSync(join(SCRIPTS_DIR, file))).digest('hex').slice(0, 16)
}

// Filenames are our own (matched against a strict pattern) - safe to inline.
function record(file) {
  psql(['-q', '-c',
    `insert into public.applied_migrations (filename, checksum)
     values ('${file}', '${checksum(file)}')
     on conflict (filename) do nothing;`])
}

ensureTable()
const applied = appliedSet()
const files = migrationFiles()
const allPending = files.filter((f) => !applied.has(f))

// A held migration is not pending - it is decided. It only rejoins the queue when its number
// is named with --release-hold, which forces whoever is running this past the recorded reason.
const { pending, held } = splitHeld(allPending, RELEASED)

// Answered BEFORE the "nothing to do" exit below, because --only=125 against a database where
// 125 is the only outstanding file would otherwise report "up to date", which is the opposite
// of what the operator needs to hear.
if (ONLY && mode === '--apply') {
  const blocked = [...ONLY].map((n) => heldByNumber(n)).filter((h) => h && held.includes(h.file))
  if (blocked.length) {
    for (const h of blocked) {
      console.error(`--only names a HELD migration: ${h.file}`)
      console.error(`  why it is held: ${h.reason}`)
      console.error(`  to release it:  ${h.releaseNeeds}`)
    }
    process.exit(1)
  }
}

function reportHolds() {
  if (!HELD_MIGRATIONS.length) return
  console.log('')
  for (const h of HELD_MIGRATIONS) {
    const state = applied.has(h.file)
      ? 'already applied on THIS database'
      : RELEASED.has(prefixNum(h.file))
        ? 'RELEASED for this run'
        : 'held back here'
    console.log(`held: ${h.file}  (${state}, since ${h.since})`)
    console.log(`  why: ${h.reason}`)
    if (!applied.has(h.file)) console.log(`  to release: ${h.releaseNeeds}`)
  }
}

if (mode === '--status') {
  console.log(
    `applied: ${applied.size}   pending: ${pending.length}   held: ${held.length}   total: ${files.length}`
  )
  if (pending.length) console.log('pending:\n  ' + pending.join('\n  '))
  reportHolds()
  process.exit(0)
}

if (mode === '--baseline') {
  // Baselining a held file would record it as applied WITHOUT running it, which is strictly
  // worse than applying it: the ledger would then claim prod has a trigger it does not have.
  let toRecord = files.filter((f) => !applied.has(f) && !held.includes(f))
  if (THROUGH !== null) toRecord = toRecord.filter((f) => prefixNum(f) <= THROUGH)
  if (!toRecord.length) { console.log('nothing to baseline - all files already recorded.'); process.exit(0) }
  // One round-trip, not one-per-file (the DB is remote).
  const values = toRecord.map((f) => `('${f}', '${checksum(f)}')`).join(', ')
  psql(['-q', '-c',
    `insert into public.applied_migrations (filename, checksum)
     values ${values}
     on conflict (filename) do nothing;`])
  console.log(`baselined ${toRecord.length} migration(s) as already-applied - nothing was executed.`)
  reportHolds()
  process.exit(0)
}

if (!pending.length) {
  console.log('up to date - no pending migrations.')
  reportHolds()
  process.exit(0)
}

// --only runs a subset; everything it skips stays pending and is reported, so a deliberately
// held-back migration can never be mistaken for one that already ran.
const toApply = ONLY ? pending.filter((f) => ONLY.has(prefixNum(f))) : pending
if (ONLY) {
  const missing = [...ONLY].filter((n) => !toApply.some((f) => prefixNum(f) === n))
  if (missing.length) {
    console.error(`--only named migration(s) that are not pending: ${missing.join(', ')}`)
    process.exit(1)
  }
  const held = pending.filter((f) => !ONLY.has(prefixNum(f)))
  if (held.length) console.log(`holding back ${held.length} pending migration(s):\n  ${held.join('\n  ')}\n`)
}

for (const f of toApply) {
  process.stdout.write(`applying ${f} ... `)
  try {
    psql(['-f', join(SCRIPTS_DIR, f)]) // the file owns its BEGIN/COMMIT
    record(f)
    console.log('ok')
  } catch (e) {
    console.log('FAILED')
    console.error(e.stderr || e.message)
    console.error(`\nStopped at ${f}. It rolled back (files are wrapped in BEGIN/COMMIT); fix and re-run.`)
    process.exit(1)
  }
}
console.log(`applied ${toApply.length} migration(s).`)
reportHolds()
