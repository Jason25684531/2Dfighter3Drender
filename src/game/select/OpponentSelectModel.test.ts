import { describe, expect, it } from 'vitest'
import { OpponentSelectModel } from './OpponentSelectModel'
import type { CharacterEntry } from '../ui/assets/TestAssetManifest'

const entry = (id: string, status: CharacterEntry['status'] = 'AVAILABLE'): CharacterEntry => ({ id, displayName: id, type: 'FEATURED', status, previewUrl: '' })
const entries = [entry('a'), entry('b'), entry('c', 'PROCESSING'), entry('d', 'READY')]

describe('OpponentSelectModel', () => {
  it('excludes the player and characters that are not usable', () => {
    expect(new OpponentSelectModel(entries, 'a').candidates.map((e) => e.id)).toEqual(['b', 'd'])
  })

  it('locks a choice and starts at NORMAL', () => {
    const model = new OpponentSelectModel(entries); expect(model.difficulty).toBe('NORMAL'); expect(model.canProceed()).toBe(false)
    expect(model.select(1)).toBe(true); expect(model.result()).toEqual({ characterId: 'b', difficulty: 'NORMAL' }); expect(model.canProceed()).toBe(true)
  })

  it('cancels a lock so the player can reselect, and reports when there is nothing to cancel', () => {
    const model = new OpponentSelectModel(entries); expect(model.cancel()).toBe(false)
    model.select(0); expect(model.cancel()).toBe(true); expect(model.canProceed()).toBe(false); expect(model.result()).toBeUndefined()
    model.select(1); expect(model.result()?.characterId).toBe('b')
  })

  it('cycles difficulty and rejects invalid indices', () => {
    const model = new OpponentSelectModel(entries); expect([model.cycleDifficulty(), model.cycleDifficulty(), model.cycleDifficulty()]).toEqual(['HARD', 'EASY', 'NORMAL'])
    for (const index of [-1, 99, 1.5, NaN]) expect(model.select(index)).toBe(false)
  })

  it('restores a previous choice for replay', () => {
    const model = new OpponentSelectModel(entries, 'a', { characterId: 'd', difficulty: 'HARD' })
    expect(model.locked?.id).toBe('d'); expect(model.cursor).toBe(1); expect(model.difficulty).toBe('HARD')
    expect(new OpponentSelectModel(entries, 'a', { characterId: 'zzz', difficulty: 'HARD' }).canProceed()).toBe(false)
  })
})
