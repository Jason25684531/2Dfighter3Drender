import { describe, expect, it } from 'vitest'
import { combatMapping, resolveDemo, semanticAnimation } from './OperationMapping'
import { MAX_SCROLL, stageCamera } from '../ui/stage/StageCamera'
import { ARENA_WIDTH, STAGE_TUNING } from '../config/stageTuning'

describe('隔離操作展示', () => {
  it('分開 owner、支援覆寫及 facing', () => {
    const held = new Set(['KeyF', 'Numpad2'])
    expect(resolveDemo(held, 'RIGHT', combatMapping.P1)).toBe('PUNCH_LIGHT')
    expect(resolveDemo(held, 'LEFT', combatMapping.P2)).toBe('PUNCH_HEAVY')
    expect(resolveDemo(new Set(['KeyZ']), 'RIGHT', { ...combatMapping.P1, lightKick: 'KeyZ' })).toBe('KICK_LIGHT')
    expect(resolveDemo(new Set(['KeyA']), 'RIGHT', combatMapping.P1)).toBe('BLOCK')
    expect(resolveDemo(new Set(['KeyA']), 'LEFT', combatMapping.P1)).toBe('MOVE')
  })
  it('空中、蹲姿與拳腳語意不同', () => {
    for (const [modifier, attack, result] of [['KeyW', 'KeyF', 'PUNCH_AIR'], ['KeyS', 'KeyU', 'PUNCH_CROUCH'], ['KeyW', 'KeyI', 'KICK_AIR'], ['KeyS', 'KeyG', 'KICK_CROUCH']])
      expect(resolveDemo(new Set([modifier, attack]), 'RIGHT', combatMapping.P1)).toBe(result)
    expect(Object.keys(semanticAnimation)).toHaveLength(16)
  })
})
describe('雙目標視覺鏡頭', () => {
  it('追兩人中點，碰到場地邊界停住', () => {
    const c = ARENA_WIDTH / 2
    expect(stageCamera(0, c - 400, c + 400, 10)).toBeCloseTo(0, 6)
    expect(stageCamera(0, 60, 900, 10)).toBeCloseTo(-MAX_SCROLL, 6)
    expect(stageCamera(0, ARENA_WIDTH - 900, ARENA_WIDTH - 60, 10)).toBeCloseTo(MAX_SCROLL, 6)
    expect(stageCamera(0, c - 640, c + 160, 10)).toBeCloseTo(-240, 6)
    expect(MAX_SCROLL * STAGE_TUNING.parallax.background).toBeCloseTo(STAGE_TUNING.backgroundTravel, 6) // 背景剛好用滿每邊 480
  })
  it('30／60／144Hz 同樣收斂且不超界', () => {
    const results = [30, 60, 144].map(hz => { let x = 0; for (let i = 0; i < hz; i++) x = stageCamera(x, 60, 500, 1 / hz); return x })
    expect(results[0]).toBeCloseTo(results[1], 6)
    expect(results[1]).toBeCloseTo(results[2], 6)
    expect(results.every(x => x >= -MAX_SCROLL && x <= MAX_SCROLL)).toBe(true)
  })
})
