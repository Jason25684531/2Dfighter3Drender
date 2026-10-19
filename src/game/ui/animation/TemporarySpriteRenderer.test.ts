import { describe, expect, it, vi } from 'vitest'
import { CombatWorld } from '../../combat/CombatWorld'
import { FIXED_STEP_MS, GameClock } from '../../time/GameClock'

vi.mock('phaser', () => ({ default: { GameObjects: { Container: class {
  x = 0; y = 0
  constructor(public scene: unknown) {}
  add(): void {}
  setScale(): void {}
  setPosition(x: number, y: number): void { this.x = x; this.y = y }
} } } }))
vi.mock('../VisualComponents', () => ({ fighterSilhouette: vi.fn() }))

import { TemporarySpriteRenderer } from './TemporarySpriteRenderer'

describe('TemporarySpriteRenderer', () => {
  it('interpolates positions and shadow, snaps discontinuities, and freezes with the clock', () => {
    const shadow = { setY: vi.fn() }
    const scene = { add: { ellipse: () => shadow }, textures: { exists: () => false } }
    const renderer = new TemporarySpriteRenderer(scene as never, undefined, 0, 820)
    const fighter = new CombatWorld().getFighter('PLAYER')
    renderer.update(fighter, 10); renderer.renderAt(0)
    expect([renderer.x, renderer.y]).toEqual([560, 820])
    const current = { ...fighter, x: 578, y: 789 }
    renderer.update(current, 11); renderer.renderAt(0.5)
    expect([renderer.x, renderer.y]).toEqual([569, 804.5])
    expect(shadow.setY).toHaveBeenLastCalledWith(20.5)
    expect(current).toEqual({ ...fighter, x: 578, y: 789 })
    const clock = new GameClock(); clock.start(); clock.advance(FIXED_STEP_MS / 2); clock.pause()
    clock.advance(100); renderer.renderAt(clock.getRemainderMs() / FIXED_STEP_MS)
    expect([renderer.x, renderer.y]).toEqual([569, 804.5])
    for (const tick of [0, 4, 4]) {
      renderer.update(fighter, tick); renderer.renderAt(0.25)
      expect([renderer.x, renderer.y]).toEqual([560, 820])
    }
  })
})
