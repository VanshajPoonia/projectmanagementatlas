#!/usr/bin/env node
// Database guardrail — the mechanical backstop behind one promise:
//   the PRODUCTION database (the live app) is never touched by tenancy work,
//   and every write is confined to the DEV sandbox.
//
// This is an ALLOWLIST, not just a blocklist. A script that imports it will:
//   - hard-abort (before opening any connection) if the active env points at PROD,
//   - hard-abort if it points at ANY project other than the known dev sandbox
//     (a typo, a third project, an empty env — anything unrecognized),
//   - proceed only when the target is exactly the dev sandbox.
//
// Import it from any write-path script:  import { assertDevDatabase } from './guard-db.mjs'
// Or run it standalone to see where you're pointed:  pnpm guard

import { pathToFileURL } from 'node:url'

export const PROD_REF = 'icyfluwgyuimhwlddjyy' // the live app — NEVER a target
export const DEV_REF = 'pxzpewaerhjwnwsbaklc' // the tenancy sandbox — the ONLY allowed target

// Supabase project refs are 20-char lowercase-alphanumeric. Pull every ref that appears
// in a connection string / URL, in any shape we use:
//   db.<ref>.supabase.co   |   https://<ref>.supabase.co   |   postgres.<ref>  (pooler user)
function extractRefs(...strings) {
  const refs = new Set()
  for (const s of strings) {
    if (!s) continue
    // Known-ref substring scan first — format-independent, cannot be fooled by URL shape.
    if (s.includes(PROD_REF)) refs.add(PROD_REF)
    if (s.includes(DEV_REF)) refs.add(DEV_REF)
    // General extraction so an UNKNOWN ref (typo / third project) is caught by the allowlist.
    for (const m of s.matchAll(/([a-z0-9]{20})\.supabase\.co/g)) refs.add(m[1])
    for (const m of s.matchAll(/postgres\.([a-z0-9]{20})/g)) refs.add(m[1])
  }
  return [...refs]
}

function abort(lines) {
  console.error('\n' + '='.repeat(66))
  console.error('  ⛔  DB GUARDRAIL TRIPPED — aborting BEFORE any connection is opened')
  console.error('='.repeat(66))
  for (const l of lines) console.error('  ' + l)
  console.error('='.repeat(66) + '\n')
  process.exit(1)
}

// Validates the active environment. Returns the dev ref on success; never returns otherwise.
export function assertDevDatabase({ silent = false } = {}) {
  const pg = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || ''
  const rest = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const refs = extractRefs(pg, rest)

  // 1. Explicit PROD block — the loudest, most specific message.
  if (refs.includes(PROD_REF)) {
    abort([
      'The active connection points at PRODUCTION:',
      `    ${PROD_REF}   (the live app — off-limits to tenancy scripts)`,
      '',
      'The only allowed target is the dev sandbox:',
      `    ${DEV_REF}`,
      '',
      'Fix .env.local — POSTGRES_URL_NON_POOLING / NEXT_PUBLIC_SUPABASE_URL',
      'must reference the dev project, then re-run.',
    ])
  }

  // 2. Nothing recognizable — refuse rather than run against an unknown DB.
  if (refs.length === 0) {
    abort([
      'Could not identify a Supabase project from the environment.',
      'POSTGRES_URL_NON_POOLING / NEXT_PUBLIC_SUPABASE_URL are missing or unrecognized.',
      'Refusing to run against an unknown target.',
    ])
  }

  // 3. Allowlist — any ref that is not the dev sandbox is rejected.
  const unexpected = refs.filter((r) => r !== DEV_REF)
  if (unexpected.length > 0) {
    abort([
      'The active connection points at an unexpected project:',
      `    ${unexpected.join(', ')}`,
      '',
      'The only allowed target is the dev sandbox:',
      `    ${DEV_REF}`,
    ])
  }

  if (!silent) console.log(`✅ DB guardrail OK — target is the dev sandbox (${DEV_REF}).`)
  return DEV_REF
}

// Migration-target variant. Once this repo became the single folder for BOTH the live app and
// the tenancy rebuild, "never touch prod" stopped being correct — legitimate prod migrations
// exist. So: dev is always allowed; PROD requires a deliberate `--allow-prod` opt-in and prints
// an unmissable banner. An unknown target is refused either way, and an environment that names
// BOTH projects is refused rather than guessed at.
export function assertMigrationTarget({ allowProd = false } = {}) {
  const pg = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || ''
  const rest = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const refs = extractRefs(pg, rest)

  if (refs.length === 0) {
    abort([
      'Could not identify a Supabase project from the environment.',
      'Refusing to run a migration against an unknown target.',
    ])
  }

  const isProd = refs.includes(PROD_REF)
  const isDev = refs.includes(DEV_REF)

  if (isProd && isDev) {
    abort([
      'The environment references BOTH projects at once:',
      `    prod ${PROD_REF} and dev ${DEV_REF}`,
      '',
      'Refusing to guess which one you meant. Set exactly one target.',
    ])
  }

  if (isProd) {
    if (!allowProd) {
      abort([
        'The active connection points at PRODUCTION:',
        `    ${PROD_REF}   (the live app)`,
        '',
        'Prod migrations are possible but must be deliberate. If you truly',
        'intend to migrate production, re-run with --allow-prod.',
        'Destructive tenancy migrations must NEVER be run this way.',
      ])
    }
    console.error('\n' + '!'.repeat(66))
    console.error(`  ⚠️   RUNNING AGAINST PRODUCTION — ${PROD_REF}`)
    console.error('  This is the LIVE database. --allow-prod was passed explicitly.')
    console.error('!'.repeat(66) + '\n')
    return PROD_REF
  }

  if (!isDev) {
    abort([
      `Unexpected project: ${refs.join(', ')}`,
      `Allowed: dev ${DEV_REF}, or prod ${PROD_REF} with --allow-prod.`,
    ])
  }

  console.log(`✅ DB guardrail OK — target is the dev sandbox (${DEV_REF}).`)
  return DEV_REF
}

// Standalone mode: `node scripts/guard-db.mjs` / `pnpm guard` — report and exit.
// Compare via pathToFileURL so a repo path containing spaces (e.g. "Project manager")
// still matches import.meta.url, which percent-encodes them. The naive
// `file://${process.argv[1]}` form silently fails to match on such paths.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertDevDatabase()
}
