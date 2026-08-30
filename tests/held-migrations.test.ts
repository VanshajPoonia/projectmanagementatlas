// The hold mechanism, tested without a database.
//
// What is being pinned here is not "the list has one entry" - it is the two properties that
// make a hold safer than the --only convention it replaces: a held file never reaches the
// apply queue by default, and naming it costs a deliberate flag.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Plain .mjs, deliberately framework-free like the runner it backs.
import { HELD_MIGRATIONS, isHeld, heldByNumber, splitHeld } from '../scripts/held-migrations.mjs'

type Held = { file: string; since: string; reason: string; releaseNeeds: string }
const holds = HELD_MIGRATIONS as Held[]
const scriptsDir = resolve(__dirname, '..', 'scripts')

describe('the held-migrations manifest', () => {
  it('names files that actually exist on disk', () => {
    const onDisk = new Set(readdirSync(scriptsDir).filter((f) => /^\d{3,}.*\.sql$/.test(f)))
    for (const h of holds) expect(onDisk.has(h.file), `${h.file} is not in scripts/`).toBe(true)
  })

  it('records a reason and a release path for every hold', () => {
    // A hold with no stated reason decays into "nobody remembers why", which is how a
    // deliberate decision turns back into drift.
    for (const h of holds) {
      expect(h.reason.length, `${h.file} has no reason`).toBeGreaterThan(40)
      expect(h.releaseNeeds.length, `${h.file} has no release path`).toBeGreaterThan(20)
      expect(h.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('holds a migration whose own header says it is not --allow-prod eligible', () => {
    // The manifest and the SQL file must not disagree about whether the file is safe to ship.
    for (const h of holds) {
      const sql = readFileSync(resolve(scriptsDir, h.file), 'utf8')
      expect(sql).toMatch(/NOT --allow-prod ELIGIBLE/i)
    }
  })
})

describe('splitHeld', () => {
  const held = holds[0]?.file
  const heldNum = Number.parseInt(held.match(/^(\d+)/)![1], 10)

  it('keeps a held file out of the apply queue', () => {
    const r = splitHeld(['124_x.sql', held, '128_y.sql'])
    expect(r.pending).toEqual(['124_x.sql', '128_y.sql'])
    expect(r.held).toEqual([held])
  })

  it('lets a later migration ship without sweeping the held one up with it', () => {
    // This is the hazard the mechanism exists for: before it, a bare `pnpm migrate
    // --allow-prod` run to ship 128 would have applied the held file as a side effect.
    const r = splitHeld([held, '128_y.sql'])
    expect(r.pending).not.toContain(held)
  })

  it('returns it to the queue only when its number is released', () => {
    const r = splitHeld([held, '128_y.sql'], new Set([heldNum]))
    expect(r.pending).toContain(held)
    expect(r.held).toEqual([])
  })

  it('is not fooled by releasing some other number', () => {
    const r = splitHeld([held], new Set([heldNum + 1, 999]))
    expect(r.held).toEqual([held])
  })

  it('leaves an unheld queue completely alone', () => {
    const files = ['120_a.sql', '121_b.sql', '128_y.sql']
    expect(splitHeld(files).pending).toEqual(files)
    expect(splitHeld(files).held).toEqual([])
  })

  it('answers isHeld and heldByNumber consistently', () => {
    expect(isHeld(held)).toBe(true)
    expect(isHeld('128_y.sql')).toBe(false)
    expect(heldByNumber(heldNum)?.file).toBe(held)
    expect(heldByNumber(999)).toBeUndefined()
  })
})
