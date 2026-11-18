import { describe, expect, it } from 'vitest'
import { MatchController } from './MatchController'
import { practiceTick } from './practice'

const punch = { moveX: 0, jumpPressed: false, attackPressed: true, attack: 'LIGHT_PUNCH' as const }

describe('P3 practice', () => {
  it('keeps the CPU dummy still and passive', () => {
    const match = new MatchController()
    const start = match.world.getFighter('ENEMY').x
    for (let tick = 0; tick < 24 * 20; tick++) {
      practiceTick(match, punch)
      expect(match.world.getFighter('ENEMY').attackPhase).toBe('NONE')
    }
    expect(match.world.getFighter('ENEMY').x).toBe(start)
  })

  it('restarts at full HP after a knockout instead of ending', () => {
    const match = new MatchController()
    const maxHp = match.world.getConfig().maxHp
    practiceTick(match, punch)
    ;(match.world as unknown as { fighters: { ENEMY: { currentHP: number } } }).fighters.ENEMY.currentHP = 0
    for (let tick = 0; tick < 3; tick++) practiceTick(match, punch)
    const snapshot = match.getSnapshot()
    expect(snapshot.matchState).toBe('FIGHTING')
    expect(snapshot.world.fighters.ENEMY.currentHP).toBe(maxHp)
    expect(match.getCompletedMatch()).toBeUndefined()
  })

  it('lets 2P drive the opponent in versus practice', () => {
    const match = new MatchController()
    for (let tick = 0; tick < 24; tick++) practiceTick(match, undefined, { moveX: -1, jumpPressed: false, attackPressed: false })
    expect(match.world.getFighter('ENEMY').x).toBeLessThan(new MatchController().world.getFighter('ENEMY').x)
  })
})
