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

  const fake = (key: string) => {
    const log = { alphas: [] as number[], ys: [] as number[], frames: [] as number[] }
    const image = { height: 256, texture: { key }, frame: { name: 0 }, setOrigin() { return this }, setScale() { return this }, setY(y: number) { log.ys.push(y); return this },
      setAlpha(a: number) { log.alphas.push(a); return this }, setTexture(k: string, f: number) { this.texture.key = k; this.frame.name = f; log.frames.push(f); return this } }
    const scene = { add: { ellipse: () => ({ setY: vi.fn() }), image: () => image }, textures: { exists: () => true } }
    return { log, renderer: new TemporarySpriteRenderer(scene as never, 'go', 820) }
  }

  it('shows a steady translucent body, not a blink, while invulnerable', () => {
    const { log, renderer } = fake('go-idle')
    const fighter = new CombatWorld().getFighter('PLAYER')
    for (let tick = 0; tick < 6; tick += 1) renderer.update({ ...fighter, invulnerableTicks: 8 - tick }, tick)
    renderer.update(fighter, 6)
    expect(new Set(log.alphas.slice(0, 6)).size).toBe(1); expect(log.alphas[0]).toBeLessThan(1)
    expect(log.alphas.at(-1)).toBe(1)
  })

  it('keeps the fall moving forward when a flinch turns into a knockdown', () => {
    const { log, renderer } = fake('go-idle')
    const fighter = new CombatWorld().getFighter('PLAYER')
    for (let tick = 0; tick < 12; tick += 1) renderer.update({ ...fighter, state: 'HIT_STUN', hitStunTicks: 14 - tick }, tick)
    const flinch = log.frames.length
    for (let tick = 12; tick < 26; tick += 1) renderer.update({ ...fighter, state: 'KNOCKDOWN', knockdownTicks: 26 - tick }, tick)
    expect(log.frames.length).toBeGreaterThan(flinch)
    expect(log.frames.every((frame, i) => i === 0 || frame >= log.frames[i - 1])).toBe(true)
    expect(log.frames.at(-1)).toBe(7)
  })

  it('keeps the winner on the ground while the victory animation plays', () => {
    const { log, renderer } = fake('go-idle')
    const fighter = new CombatWorld().getFighter('PLAYER')
    for (let tick = 0; tick < 40; tick += 1) renderer.update(fighter, tick, { outcome: 'WIN' })
    expect(log.ys.every((y) => y === 0)).toBe(true)
  })

  it('draws generated characters at the same battle height as the roster', () => {
    const create = (id: 's1aw' | 'generated-check') => {
      const image = { height: 1024, texture: { key: `${id}-idle` }, frame: { name: 0 }, setOrigin() { return this }, setScale: vi.fn(), setTexture() { return this } }
      const scene = { add: { ellipse: () => ({ setY: vi.fn() }), image: () => image }, textures: { exists: () => true } }
      return { image, renderer: new TemporarySpriteRenderer(scene as never, id, 820) }
    }
    const regular = create('s1aw'), generated = create('generated-check')
    expect(regular.image.setScale).toHaveBeenCalledWith(975 / 1024)
    expect(generated.image.setScale).toHaveBeenCalledWith(975 / 1024)
    expect(generated.renderer.pose(new CombatWorld().getFighter('PLAYER'))?.scale).toBe(975 / 1024)
    expect(generated.renderer.pose(new CombatWorld().getFighter('PLAYER'))?.originY).toBe(848 / 1024)
  })
})
