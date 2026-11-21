import { describe, expect, it } from 'vitest'

import {
  aggregateLength,
  moveItem,
  normalizeName,
  validateDraftItems,
} from '@/lib/instruction-skills'

describe('instruction-skills validation', () => {
  it('normalizes names for uniqueness', () => {
    expect(normalizeName('  Hello ')).toBe('hello')
  })

  it('rejects blank names and duplicate case-insensitive names', () => {
    expect(
      validateDraftItems([
        { name: ' ', description: '', instructions: 'do' },
      ]),
    ).toMatch(/non-empty name/)
    expect(
      validateDraftItems([
        { name: 'Alpha', description: '', instructions: 'one' },
        { name: 'alpha', description: '', instructions: 'two' },
      ]),
    ).toMatch(/unique/i)
  })

  it('allows an empty collection', () => {
    expect(validateDraftItems([])).toBeNull()
  })

  it('sums aggregate length and reorders items', () => {
    const items = [
      { name: 'a', description: 'b', instructions: 'c' },
      { name: 'd', description: 'e', instructions: 'f' },
    ]
    expect(aggregateLength(items)).toBe(6)
    expect(moveItem(items, 1, 'up').map((item) => item.name)).toEqual(['d', 'a'])
    expect(moveItem(items, 0, 'down').map((item) => item.name)).toEqual(['d', 'a'])
    expect(moveItem(items, 0, 'up')).toEqual(items)
  })
})
