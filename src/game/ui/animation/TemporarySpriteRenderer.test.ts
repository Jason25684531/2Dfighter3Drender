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

import { TemporarySpriteRenderer } from './TemporarySpriteRenderer'

describe('TemporarySpriteRenderer', () => {
  it('interpolates positions and shadow, snaps discontinuities, and freezes with the clock', () => {
    const shadow = { setY: vi.fn() }
    const scene = { add: { ellipse: () => shadow }, textures: { exists: () => false } }
    const renderer = new TemporarySpriteRenderer(scene as never, undefined, 820)
    const fighter = { ...new CombatWorld().getFighter('PLAYER'), x: 560 }
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

  it('blinks while invulnerable and restores full alpha afterwards', () => {
    const alphas: number[] = []
    const image = { height: 128, texture: { key: 'kevin-idle' }, frame: { name: 0 }, setOrigin() { return this }, setScale() { return this }, setTexture() { return this }, setAlpha(a: number) { alphas.push(a); return this } }
    const scene = { add: { ellipse: () => ({ setY: vi.fn() }), image: () => image }, textures: { exists: () => true } }
    const renderer = new TemporarySpriteRenderer(scene as never, 'kevin', 820)
    const fighter = new CombatWorld().getFighter('PLAYER')
    for (let tick = 0; tick < 4; tick += 1) renderer.update({ ...fighter, invulnerableTicks: 5 }, tick)
    renderer.update(fighter, 4)
    expect(alphas).toEqual([1, 1, 0.35, 0.35, 1])
  })

  it('doubles the battle display scale only for generated characters', () => {
    const create = (id: 's1aw' | 'generated-check') => {
      const image = { height: 1024, texture: { key: `${id}-idle` }, frame: { name: 0 }, setOrigin() { return this }, setScale: vi.fn(), setTexture() { return this } }
      const scene = { add: { ellipse: () => ({ setY: vi.fn() }), image: () => image }, textures: { exists: () => true } }
      return { image, renderer: new TemporarySpriteRenderer(scene as never, id, 820) }
    }
    const regular = create('s1aw'), generated = create('generated-check')
    expect(regular.image.setScale).toHaveBeenCalledWith(650 / 1024)
    expect(generated.image.setScale).toHaveBeenCalledWith(1300 / 1024)
    expect(generated.renderer.pose(new CombatWorld().getFighter('PLAYER'))?.scale).toBe(1300 / 1024)
    expect(generated.renderer.pose(new CombatWorld().getFighter('PLAYER'))?.originY).toBe(848 / 1024)
  })
})
