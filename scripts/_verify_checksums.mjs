// Read-only: does every file on disk still hash to what the ledger recorded when it was applied?
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const DIR = dirname(fileURLToPath(import.meta.url))
const PSQL = ['/opt/homebrew/opt/libpq/bin/psql', '/usr/local/opt/libpq/bin/psql', 'psql']
  .find((c) => { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return true } catch { return false } })
const sum = (f) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex').slice(0, 16)
const rows = execFileSync(PSQL, [process.env.POSTGRES_URL_NON_POOLING, '-tAq', '-F', '\t', '-c',
  'select filename, checksum from public.applied_migrations order by filename'],
  { encoding: 'utf8' })
const ledger = new Map(rows.trim().split('\n').filter(Boolean).map((l) => l.split('\t')))
const files = readdirSync(DIR).filter((f) => /^\d{3,}.*\.sql$/.test(f)).sort()
let bad = 0
for (const f of files) {
  const recorded = ledger.get(f)
  if (!recorded) { console.log(`PENDING  ${f}`); continue }
  const now = sum(f)
  if (now !== recorded) { console.log(`EDITED   ${f}  ledger=${recorded} disk=${now}`); bad++ }
}
for (const f of ledger.keys()) if (!files.includes(f)) { console.log(`ORPHAN   ${f} (in ledger, not on disk)`); bad++ }
console.log(bad === 0 ? `\nOK - all ${files.length} files match the ledger` : `\n${bad} mismatch(es)`)
