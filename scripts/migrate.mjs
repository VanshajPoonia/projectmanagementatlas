#!/usr/bin/env node
// Migration runner — Phase 0 safety net.
//
// The repo has 62 hand-numbered SQL files in scripts/ that were applied to production
// by hand, with no record of what ran where. That is exactly where a tenancy migration
// mistake would leak one company's data to another and only surface via a customer.
// This runner gives us a durable record (public.applied_migrations) and applies pending
// migrations in order, each file managing its own BEGIN/COMMIT (see scripts/ convention).
//
// Reads POSTGRES_URL_NON_POOLING from the environment. Run via the package scripts, e.g.:
//   pnpm migrate:status     — list applied vs pending
//   pnpm migrate:baseline   — mark all existing files as applied WITHOUT running them
//                             (for a DB already at that schema, e.g. the seeded dev clone)
//   pnpm migrate            — apply all pending migrations in order
//
// It never DROPs or rewrites; the only object it creates itself is the tracking table.

import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertMigrationTarget } from './guard-db.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

const DB_URL = process.env.POSTGRES_URL_NON_POOLING
if (!DB_URL) {
  console.error('POSTGRES_URL_NON_POOLING is not set. Run via pnpm migrate* (loads .env.local).')
  process.exit(1)
}

// CLI: [--status | --baseline | --apply] [--allow-prod] [--through=NNN]
//   --allow-prod   deliberate opt-in required to target the live database
//   --through=NNN  with --baseline, record only files numbered <= NNN (the rest stay pending),
//                  which is how a DB that is already at migration NNN gets adopted by the runner
//                  without marking later, genuinely-unapplied files as done.
const ARGS = process.argv.slice(2)
const ALLOW_PROD = ARGS.includes('--allow-prod')
const throughArg = ARGS.find((a) => a.startsWith('--through='))
const THROUGH = throughArg ? Number.parseInt(throughArg.split('=')[1], 10) : null
const mode = ARGS.find((a) => ['--status', '--baseline', '--apply'].includes(a)) || '--apply'

// Dev is always allowed; prod requires --allow-prod. Aborts before any psql connection.
assertMigrationTarget({ allowProd: ALLOW_PROD })

// libpq/psql is often not on the default PATH on macOS — locate it.
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

// Filenames are our own (matched against a strict pattern) — safe to inline.
function record(file) {
  psql(['-q', '-c',
    `insert into public.applied_migrations (filename, checksum)
     values ('${file}', '${checksum(file)}')
     on conflict (filename) do nothing;`])
}

ensureTable()
const applied = appliedSet()
const files = migrationFiles()
const pending = files.filter((f) => !applied.has(f))

if (mode === '--status') {
  console.log(`applied: ${applied.size}   pending: ${pending.length}   total: ${files.length}`)
  if (pending.length) console.log('pending:\n  ' + pending.join('\n  '))
  process.exit(0)
}

if (mode === '--baseline') {
  const prefixNum = (f) => Number.parseInt(f.match(/^(\d+)/)[1], 10)
  let toRecord = files.filter((f) => !applied.has(f))
  if (THROUGH !== null) toRecord = toRecord.filter((f) => prefixNum(f) <= THROUGH)
  if (!toRecord.length) { console.log('nothing to baseline — all files already recorded.'); process.exit(0) }
  // One round-trip, not one-per-file (the DB is remote).
  const values = toRecord.map((f) => `('${f}', '${checksum(f)}')`).join(', ')
  psql(['-q', '-c',
    `insert into public.applied_migrations (filename, checksum)
     values ${values}
     on conflict (filename) do nothing;`])
  console.log(`baselined ${toRecord.length} migration(s) as already-applied — nothing was executed.`)
  process.exit(0)
}

if (!pending.length) { console.log('up to date — no pending migrations.'); process.exit(0) }

for (const f of pending) {
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
console.log(`applied ${pending.length} migration(s).`)
