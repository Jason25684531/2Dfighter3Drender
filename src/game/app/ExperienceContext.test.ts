import { describe, expect, it } from 'vitest'
import { ExperienceContext } from './ExperienceContext'

describe('ExperienceContext', () => {
  it('serializes and restores active session identity', () => {
    const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
    const context = new ExperienceContext(); context.set({ playerId: 1, sessionId: 2, sessionStatus: 'ACTIVE' }); context.serialize(storage)
    const restored = new ExperienceContext(); restored.restore(storage); expect(restored.snapshot).toMatchObject({ playerId: 1, sessionId: 2, sessionStatus: 'ACTIVE' })
  })
})
