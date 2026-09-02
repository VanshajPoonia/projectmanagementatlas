import { describe, it, expect } from 'vitest'
import { STRATEGY_GUIDE } from './strategy-guide'
import { AGILE_GUIDE } from './agile-guide'
import type { ProductGuide } from './product-guide'

// ⚠️ These are content assertions, and they exist for one reason: the guide IS the product's
// explanation of itself, so a claim that drifts from the code is a claim the product no longer
// keeps. The specific sentences pinned below are the ones a person acts on - what the module
// does to their boards, what anonymity does and does not promise, and who has to be involved.

const guides: [string, ProductGuide][] = [['strategy', STRATEGY_GUIDE], ['agile', AGILE_GUIDE]]

describe.each(guides)('%s guide is shaped so the dialog can render all of it', (_name, guide) => {
  it('has a title, a tagline and a summary', () => {
    expect(guide.title.length).toBeGreaterThan(0)
    expect(guide.tagline.length).toBeGreaterThan(20)
    expect(guide.summary.length).toBeGreaterThan(40)
  })

  it('gives every section an id, a heading and a body', () => {
    for (const section of guide.sections) {
      expect(section.id).toMatch(/^[a-z0-9-]+$/)
      expect(section.heading.length).toBeGreaterThan(0)
      expect(section.body.length).toBeGreaterThan(20)
    }
  })

  it('uses unique section ids, or React renders duplicate keys', () => {
    const ids = guide.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('answers real questions with real answers', () => {
    expect(guide.faq.length).toBeGreaterThan(4)
    for (const item of guide.faq) {
      expect(item.q.trim().endsWith('?')).toBe(true)
      expect(item.a.length).toBeGreaterThan(20)
    }
  })

  it('never puts an em dash in front of a reader', () => {
    const text = JSON.stringify(guide)
    expect(text.includes('—')).toBe(false)
  })
})

describe('the strategy guide says the things somebody would act on', () => {
  const text = JSON.stringify(STRATEGY_GUIDE).toLowerCase()

  it('states that switching it on changes nothing about existing boards', () => {
    expect(text).toContain('changes nothing about your boards')
  })

  it('states that the two progress figures are never combined', () => {
    expect(text).toContain('never combined')
  })

  it('explains that a goal with no numbers is still a goal', () => {
    expect(text).toContain('still a goal')
  })

  it('says health is entered by a person, not calculated', () => {
    expect(text).toContain('health is never calculated')
  })

  it('promises anonymity in the terms the database actually enforces', () => {
    expect(text).toContain('including admins')
  })

  it('and admits the one thing no setting can fix', () => {
    // Over-trusting a privacy feature is worse than not having it.
    expect(text).toContain('no setting can fix')
  })

  it('says an anonymous review cannot be switched afterwards', () => {
    expect(text).toContain('cannot be switched')
  })

  it('names who can do what, at every tier', () => {
    const whoCan = STRATEGY_GUIDE.sections.find((s) => s.id === 'who-can')
    expect(whoCan).toBeDefined()
    const steps = (whoCan?.steps ?? []).join(' ').toLowerCase()
    expect(steps).toContain('anyone signed in')
    expect(steps).toContain('any admin')
    expect(steps).toContain('super admin')
    expect(steps).toContain('guest')
  })

  it('says the owner is not needed for day-to-day use', () => {
    const faq = STRATEGY_GUIDE.faq.map((f) => f.a.toLowerCase()).join(' ')
    expect(faq).toContain('only switching the module on or off needs a super admin')
  })

  it('says nothing is deleted when the module is switched off', () => {
    expect(text).toContain('nothing is deleted')
  })

  it('explains why there is no drawing canvas', () => {
    expect(text).toContain('four lists, not a diagram')
  })
})
