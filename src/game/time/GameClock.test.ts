import { describe, expect, it } from 'vitest'
import { FIXED_STEP_MS, GameClock } from './GameClock'

describe('GameClock', () => {
  it('runs at 24Hz with remainder and multiple ticks', () => {
    const clock = new GameClock(); let ticks = 0; clock.subscribe(() => { ticks += 1 }); clock.start()
    expect(clock.advance(FIXED_STEP_MS - 1)).toBe(0); expect(ticks).toBe(0)
    expect(clock.advance(1)).toBe(1); expect(ticks).toBe(1)
    expect(clock.advance(FIXED_STEP_MS * 2 + 3)).toBe(2); expect(ticks).toBe(3); expect(clock.getRemainderMs()).toBeCloseTo(3)
  })

  it('pauses, stops, resumes, and resets without replaying elapsed time', () => {
    const clock = new GameClock(); clock.start(); clock.pause(); expect(clock.advance(1000)).toBe(0); clock.resume(); expect(clock.advance(1)).toBe(0)
    clock.stop(); expect(clock.advance(FIXED_STEP_MS)).toBe(0); clock.start(); expect(clock.advance(FIXED_STEP_MS)).toBe(1)
    clock.reset(); expect(clock.getTick()).toBe(0); expect(clock.getRemainderMs()).toBe(0)
  })

  it('caps inactive-tab catch-up at six ticks and is deterministic for equivalent deltas', () => {
    const large = new GameClock(); large.start(); expect(large.advance(5000)).toBe(6)
    const a = new GameClock(); const b = new GameClock(); a.start(); b.start(); a.advance(10); a.advance(30); b.advance(40); expect(a.getTick()).toBe(b.getTick()); expect(a.getRemainderMs()).toBeCloseTo(b.getRemainderMs())
  })
})
