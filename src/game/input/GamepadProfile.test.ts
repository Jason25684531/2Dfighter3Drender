import { describe, expect, it } from 'vitest'
import { CONTROLS_STORAGE_KEY } from './ControlProfile'
import { DEFAULT_PAD_BINDINGS, loadPadProfiles, PAD_STORAGE_KEY, padLabel, padProblem, rememberPads, samplePads, savePadProfiles, updateSlots, type PadDown, type PadSlots } from './GamepadProfile'
import type { GamepadLike } from './InputManager'

const pad = (pressed: number[] = [], axes: number[] = []): GamepadLike => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), axes: [0, 0, 0, 0].map((zero, i) => axes[i] ?? zero) })
const memory = (entries: Record<string, string> = {}) => { const data = new Map(Object.entries(entries)); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }

/** 依序餵入每一幀的 getGamepads() 結果，回傳最後的所有權。 */
const owners = (frames: (GamepadLike | null)[][]): PadSlots => {
  let slots: PadSlots = { P1: undefined, P2: undefined }, down: PadDown = new Map()
  for (const pads of frames) { const now = samplePads(pads, down); slots = updateSlots(slots, now, down); down = rememberPads(down, now) }
  return slots
}

describe('gamepad ownership', () => {
  it('gives the first pressing pad to P1 and the next to P2, whatever their index', () => {
    expect(owners([[null, pad([0])]])).toEqual({ P1: 1, P2: undefined })
    expect(owners([[null, pad([0])], [pad([3]), pad()]])).toEqual({ P1: 1, P2: 0 })
  })
  it('does not claim on a stick push or a button already held when a slot frees up', () => {
    expect(owners([[pad([], [1, 1, 1, 1])]])).toEqual({ P1: undefined, P2: undefined })
    expect(owners([[pad([0]), pad([0]), pad([0])], [null, pad([0]), pad([0])]])).toEqual({ P1: undefined, P2: 1 })
  })
  it('ignores a third pad while both players own one', () => {
    expect(owners([[pad([0]), pad([0])], [pad(), pad(), pad([0])]])).toEqual({ P1: 0, P2: 1 })
  })
  it('releases on disconnect without moving the other player, and needs a fresh press after reconnecting at the same index', () => {
    const claimed = [pad([0]), pad([0])]
    expect(owners([claimed, [null, pad()]])).toEqual({ P1: undefined, P2: 1 })
    expect(owners([claimed, [{ ...pad(), connected: false }, pad()]])).toEqual({ P1: undefined, P2: 1 })
    expect(owners([claimed, [null, pad()], [pad(), pad()]])).toEqual({ P1: undefined, P2: 1 })
    expect(owners([claimed, [null, pad()], [pad(), pad()], [pad([5]), pad()]])).toEqual({ P1: 0, P2: 1 })
  })
  it('does not count a button held through an unplug as a claiming press', () => {
    expect(owners([[pad([0])], [null], [pad([0])]])).toEqual({ P1: undefined, P2: undefined })
    expect(owners([[pad([0])], [null], [pad([0])], [pad()], [pad([0])]])).toEqual({ P1: 0, P2: undefined })
  })
})

describe('gamepad sampling', () => {
  it('reads buttons and both stick directions as pad codes', () => {
    expect([...samplePads([null, pad([2], [-1, 0, 0, 0.8])]).get(1)!].sort()).toEqual(['A0-', 'A3+', 'B2'])
  })
  it('presses at 0.5 and releases below 0.35 for axes and button values', () => {
    const run = (values: number[], code: 'A1+' | 'B6'): boolean[] => {
      let down: PadDown = new Map()
      return values.map((value) => { down = samplePads([code === 'B6' ? { buttons: Array.from({ length: 7 }, (_, i) => ({ value: i === 6 ? value : 0 })) } : { axes: [0, value] }], down); return down.get(0)!.has(code) })
    }
    expect(run([0.6, 0.45, 0.52, 0.45, 0.3], 'A1+')).toEqual([true, true, true, true, false])
    expect(run([0, 0.45, 0.49], 'A1+')).toEqual([false, false, false])
    expect(run([0.6, 0.4, 0.34], 'B6')).toEqual([true, true, false])
  })
})

describe('gamepad bindings', () => {
  it('defaults to the standard mapping: ▢ 🛆 ✕ ⭘ attacks, OPTIONS pause, D-pad directions', () => {
    expect(DEFAULT_PAD_BINDINGS).toEqual({ MOVE_LEFT: 'B14', MOVE_RIGHT: 'B15', JUMP: 'B12', CROUCH: 'B13', LIGHT_PUNCH: 'B2', HEAVY_PUNCH: 'B3', LIGHT_KICK: 'B0', HEAVY_KICK: 'B1', PAUSE: 'B9' })
  })
  it('labels buttons with the arcade stick PS marks and keeps indexes for unnamed inputs', () => {
    expect(Array.from({ length: 17 }, (_, i) => padLabel(`B${i}`))).toEqual(['✕', '⭘', '▢', '🛆', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', '↑', '↓', '←', '→', 'BTN 16'])
    expect(['A1-', 'A2+', 'A5+'].map(padLabel)).toEqual(['LS ↑', 'RS →', 'AXIS 5+'])
  })
  it('validates pad codes and reserves R1 and L3', () => {
    expect(['B0', 'B4', 'A5-'].map(padProblem)).toEqual([undefined, undefined, undefined])
    for (const bad of ['KeyF', 'B', 'A1', 'B-1', 'A2*', 'B999', 'A0+', 'A3-', 'B5', 'B10']) expect(padProblem(bad)).toBeTruthy()
    expect([padProblem('B5'), padProblem('B10')]).toEqual(['R1 IS RESERVED', 'L3 IS RESERVED'])
  })
  it('persists per-player pad bindings under exp2.gamepad.v1 without touching the keyboard save', () => {
    const store = memory({ [CONTROLS_STORAGE_KEY]: 'keyboard' })
    const profiles = { P1: { ...DEFAULT_PAD_BINDINGS, LIGHT_PUNCH: 'B4' as const }, P2: { ...DEFAULT_PAD_BINDINGS } }
    expect(savePadProfiles(profiles, store)).toBe(true)
    expect(loadPadProfiles(store)).toEqual(profiles)
    expect(JSON.parse(store.getItem(PAD_STORAGE_KEY)!).version).toBe(1)
    expect(store.getItem(CONTROLS_STORAGE_KEY)).toBe('keyboard')
  })
  it('falls back per player for missing, corrupted, wrong-version, incomplete, or duplicate data and refuses to save them', () => {
    const defaults = { P1: DEFAULT_PAD_BINDINGS, P2: DEFAULT_PAD_BINDINGS }
    const custom = { ...DEFAULT_PAD_BINDINGS, HEAVY_KICK: 'B7' }
    for (const bad of [undefined, '{not json', JSON.stringify({ version: 2, profiles: { P1: custom } }), JSON.stringify({ version: 1, profiles: { P1: { LIGHT_PUNCH: 'B4' } } }), JSON.stringify({ version: 1, profiles: { P1: { ...DEFAULT_PAD_BINDINGS, JUMP: 'B2' } } }), JSON.stringify({ version: 1, profiles: { P1: { ...DEFAULT_PAD_BINDINGS, JUMP: 'KeyW' } } }), JSON.stringify({ version: 1, profiles: { P1: { ...DEFAULT_PAD_BINDINGS, LIGHT_PUNCH: 'B5' } } }), JSON.stringify({ version: 1, profiles: { P1: { ...DEFAULT_PAD_BINDINGS, PAUSE: 'B10' } } })])
      expect(loadPadProfiles(memory(bad === undefined ? {} : { [PAD_STORAGE_KEY]: bad }))).toEqual(defaults)
    expect(loadPadProfiles(memory({ [PAD_STORAGE_KEY]: JSON.stringify({ version: 1, profiles: { P1: { LIGHT_PUNCH: 'B4' }, P2: custom } }) }))).toEqual({ P1: DEFAULT_PAD_BINDINGS, P2: custom })
    const store = memory()
    expect(savePadProfiles({ P1: { ...DEFAULT_PAD_BINDINGS, JUMP: 'B2' }, P2: DEFAULT_PAD_BINDINGS }, store)).toBe(false)
    expect(savePadProfiles({ P1: { LIGHT_PUNCH: 'B4' } as never, P2: DEFAULT_PAD_BINDINGS }, store)).toBe(false)
    expect(savePadProfiles({ P1: DEFAULT_PAD_BINDINGS, P2: { ...DEFAULT_PAD_BINDINGS, HEAVY_KICK: 'B5' } }, store)).toBe(false)
    expect(store.getItem(PAD_STORAGE_KEY)).toBeNull()
  })
})
