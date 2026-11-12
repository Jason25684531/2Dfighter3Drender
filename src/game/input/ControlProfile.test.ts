import { describe, expect, it } from 'vitest'
import { DEFAULT_PAD_BINDINGS, PAD_RULES, type PadProfiles } from './GamepadProfile'
import { COMBAT_ACTIONS, combinationRows, CONTROLS_STORAGE_KEY, ControlsEditor, DEFAULT_KEYBOARD_BINDINGS, keyLabel, keyProblem, loadProfiles, RESET_ROW, saveProfiles, type ControlProfiles } from './ControlProfile'

const memory = (value?: string) => { const data = new Map<string, string>(value === undefined ? [] : [[CONTROLS_STORAGE_KEY, value]]); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, v: string) => { data.set(key, v) } } }
const editor = (store = memory()) => new ControlsEditor(loadProfiles(store), (profiles: ControlProfiles) => saveProfiles(profiles, store))
const focus = (e: Pick<ControlsEditor, 'focus' | 'activate'>, action: number) => { e.focus = action; e.activate() }

describe('control profiles', () => {
  it('defaults P1 to A D / W S / F U G I / Esc and keeps a separate P2 profile', () => {
    expect(loadProfiles(memory()).P1).toEqual({ MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', JUMP: 'KeyW', CROUCH: 'KeyS', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', PAUSE: 'Escape' })
    expect(loadProfiles(memory()).P2.LIGHT_PUNCH).toBe('Numpad1')
    expect(['KeyA', 'ArrowLeft', 'Escape', 'Space', 'Numpad1', 'Digit3'].map(keyLabel)).toEqual(['A', '←', 'ESC', 'SPACE', 'NUM 1', '3'])
  })
  it('persists a custom binding and reloads it', () => {
    const store = memory(), e = editor(store)
    focus(e, 4); e.capture('KeyQ')
    expect(e.message).toBe('SAVED'); expect(e.bindings.LIGHT_PUNCH).toBe('KeyQ')
    expect(loadProfiles(store).P1.LIGHT_PUNCH).toBe('KeyQ')
    expect(JSON.parse(store.getItem(CONTROLS_STORAGE_KEY)!).version).toBe(3)
  })
  it('drops a former GUARD key from an old v3 save and keeps the other bindings', () => {
    const old = { ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ', GUARD: 'KeyC' }
    const loaded = loadProfiles(memory(JSON.stringify({ version: 3, profiles: { P1: old, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2, GUARD: 'Numpad3' } } })))
    expect(loaded).toEqual({ P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ' }, P2: DEFAULT_KEYBOARD_BINDINGS.P2 })
    expect(COMBAT_ACTIONS).not.toContain('GUARD')
  })
  it('falls back to defaults for corrupted, wrong-version, incomplete, or duplicate data and refuses to save them', () => {
    for (const bad of ['{not json', JSON.stringify({ version: 2, profiles: { P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyZ' } } }), JSON.stringify({ version: 3, profiles: { P1: { MOVE_LEFT: 'KeyA' } } }), JSON.stringify({ version: 3, profiles: { P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyF' } } })])
      expect(loadProfiles(memory(bad))).toEqual(DEFAULT_KEYBOARD_BINDINGS)
    const store = memory()
    expect(saveProfiles({ ...DEFAULT_KEYBOARD_BINDINGS, P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyF' } }, store)).toBe(false)
    expect(store.getItem(CONTROLS_STORAGE_KEY)).toBeNull()
  })
  it('detects a conflict and swaps so no action is left unbound', () => {
    const e = editor()
    focus(e, 2); e.capture('KeyF')
    expect(e.state).toBe('CONFLICT'); expect(e.message).toBe('F IS ALREADY ASSIGNED TO LIGHT PUNCH'); expect(e.bindings.JUMP).toBe('KeyW')
    e.activate() // SWAP 為預設
    expect([e.bindings.JUMP, e.bindings.LIGHT_PUNCH]).toEqual(['KeyF', 'KeyW'])
  })
  it('cancels a conflict, a capture (Escape, also while rebinding Pause), and rejects invalid keys', () => {
    const e = editor()
    focus(e, 2); e.capture('KeyF'); e.move(1); e.activate()
    expect([e.state, e.bindings.JUMP, e.bindings.LIGHT_PUNCH]).toEqual(['SELECT_BINDING', 'KeyW', 'KeyF'])
    focus(e, 8); e.capture('Escape'); expect([e.state, e.bindings.PAUSE]).toEqual(['SELECT_BINDING', 'Escape'])
    focus(e, 0)
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'Tab', 'F5', 'F12']) { e.capture(code); expect(e.bindings.MOVE_LEFT).toBe('KeyA') }
    expect(e.state).toBe('LISTENING_FOR_KEY'); expect(e.message).toMatch(/RESERVED/)
    expect(keyProblem('ShiftLeft')).toMatch(/MODIFIER/)
    expect(e.back()).toBe(false); expect(e.back()).toBe(true)
  })
  it('resets all P1 controls only after confirmation', () => {
    const store = memory(), e = editor(store)
    focus(e, 4); e.capture('KeyQ')
    focus(e, RESET_ROW); expect(e.state).toBe('CONFIRM_RESET')
    e.move(1); e.activate(); expect(e.bindings.LIGHT_PUNCH).toBe('KeyQ')
    focus(e, RESET_ROW); e.activate()
    expect(e.bindings).toEqual(DEFAULT_KEYBOARD_BINDINGS.P1); expect(loadProfiles(store).P1).toEqual(DEFAULT_KEYBOARD_BINDINGS.P1)
    expect(e.bindings).not.toBe(DEFAULT_KEYBOARD_BINDINGS.P1)
  })
  it('derives the combination list from current bindings', () => {
    const e = editor()
    e.focus = COMBAT_ACTIONS.indexOf('LIGHT_PUNCH'); e.activate(); e.capture('KeyQ')
    expect(combinationRows(e.bindings).map((row) => row.keys)).toEqual(['S + Q / U / G / I', 'W + Q / U / G / I', 'HOLD S / HOLD BACK A / D'])
    e.focus = RESET_ROW; e.activate(); e.activate()
    expect(combinationRows(e.bindings)[0].keys).toBe('S + F / U / G / I')
  })

  it('rejects a key used by the other player (combat or fixed back key) but allows a shared Pause', () => {
    const store = memory(), profiles = loadProfiles(store), p2 = new ControlsEditor(profiles, (next) => saveProfiles(next, store), 'P2'), p1 = new ControlsEditor(profiles, (next) => saveProfiles(next, store))
    focus(p2, COMBAT_ACTIONS.indexOf('JUMP')); p2.capture('KeyF')
    expect([p2.message, p2.bindings.JUMP, p2.state]).toEqual(['F IS USED BY PLAYER 1', 'ArrowUp', 'LISTENING_FOR_KEY'])
    focus(p1, COMBAT_ACTIONS.indexOf('LIGHT_KICK')); p1.capture('Backspace')
    expect([p1.message, p1.bindings.LIGHT_KICK]).toEqual(['BACKSPACE IS USED BY PLAYER 2', 'KeyG'])
    p2.capture('Escape'); focus(p2, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p2.capture('KeyL')
    expect(loadProfiles(store).P2.LIGHT_PUNCH).toBe('KeyL'); expect(loadProfiles(store).P1.PAUSE).toBe(loadProfiles(store).P2.PAUSE)
  })
  it('refuses a reset that would collide with the other player and resets P2 alone otherwise', () => {
    const store = memory(), profiles = loadProfiles(store), p1 = new ControlsEditor(profiles, (next) => saveProfiles(next, store)), p2 = new ControlsEditor(profiles, (next) => saveProfiles(next, store), 'P2')
    focus(p2, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p2.capture('KeyL'); focus(p1, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p1.capture('KeyQ')
    focus(p2, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p2.capture('KeyF') // 1P 已改 Q，F 可用
    focus(p1, RESET_ROW); p1.activate()
    expect([p1.message, p1.bindings.LIGHT_PUNCH]).toEqual(['F IS USED BY PLAYER 2', 'KeyQ'])
    focus(p2, RESET_ROW); p2.activate()
    expect(p2.bindings).toEqual(DEFAULT_KEYBOARD_BINDINGS.P2); expect(p1.bindings.LIGHT_PUNCH).toBe('KeyQ')
  })
  it('falls back P2, then P1, when stored profiles collide across players and never saves a collision', () => {
    const p1Arrows = { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'ArrowUp' }
    expect(loadProfiles(memory(JSON.stringify({ version: 3, profiles: { P1: p1Arrows, P2: DEFAULT_KEYBOARD_BINDINGS.P2 } }))).P1.JUMP).toBe('KeyW')
    const p2Custom = { ...DEFAULT_KEYBOARD_BINDINGS.P2, LIGHT_PUNCH: 'KeyQ' }, p1Q = { ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ' }
    expect(loadProfiles(memory(JSON.stringify({ version: 3, profiles: { P1: p1Q, P2: p2Custom } })))).toEqual({ P1: p1Q, P2: DEFAULT_KEYBOARD_BINDINGS.P2 })
    expect(saveProfiles({ P1: p1Q, P2: p2Custom }, memory())).toBe(false)
  })
})

describe('gamepad controls editor', () => {
  const pads = (): PadProfiles => ({ P1: { ...DEFAULT_PAD_BINDINGS }, P2: { ...DEFAULT_PAD_BINDINGS } })
  const padEditor = (player: 'P1' | 'P2' = 'P1', profiles = pads(), saved: PadProfiles[] = []) => new ControlsEditor(profiles, (next) => { saved.push(structuredClone(next)) }, player, PAD_RULES)
  it('binds a captured pad code with pad labels and saves', () => {
    const saved: PadProfiles[] = [], e = padEditor('P1', pads(), saved)
    focus(e, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); e.capture('B4')
    expect([e.bindings.LIGHT_PUNCH, e.message, saved.at(-1)?.P1.LIGHT_PUNCH]).toEqual(['B4', 'SAVED', 'B4'])
    focus(e, COMBAT_ACTIONS.indexOf('HEAVY_KICK')); e.capture('KeyF')
    expect([e.bindings.HEAVY_KICK, e.state]).toEqual(['B1', 'LISTENING_FOR_KEY'])
  })
  it('swaps or cancels a same-player conflict and labels it with pad names', () => {
    const e = padEditor()
    focus(e, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); e.capture('B3')
    expect([e.state, e.message]).toEqual(['CONFLICT', '🛆 IS ALREADY ASSIGNED TO HEAVY PUNCH'])
    e.move(1); e.activate(); expect([e.bindings.LIGHT_PUNCH, e.bindings.HEAVY_PUNCH]).toEqual(['B2', 'B3'])
    focus(e, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); e.capture('B3'); e.activate()
    expect([e.bindings.LIGHT_PUNCH, e.bindings.HEAVY_PUNCH]).toEqual(['B3', 'B2'])
  })
  it('lets both players use the same button and resets one player only', () => {
    const profiles = pads(), p1 = padEditor('P1', profiles), p2 = padEditor('P2', profiles)
    focus(p1, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p1.capture('B4'); focus(p2, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH')); p2.capture('B4')
    expect([profiles.P1.LIGHT_PUNCH, profiles.P2.LIGHT_PUNCH, p2.message]).toEqual(['B4', 'B4', 'SAVED'])
    focus(p2, RESET_ROW); p2.activate()
    expect(profiles.P2).toEqual(DEFAULT_PAD_BINDINGS); expect(profiles.P1.LIGHT_PUNCH).toBe('B4'); expect(profiles.P2).not.toBe(DEFAULT_PAD_BINDINGS)
  })
  it('refuses a stick direction that is already a fixed direction source, but accepts other axes', () => {
    const e = padEditor()
    focus(e, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH'))
    for (const stick of ['A0+', 'A1-', 'A2-', 'A3+']) {
      e.capture(stick)
      expect([e.bindings.LIGHT_PUNCH, e.state]).toEqual(['B2', 'LISTENING_FOR_KEY']); expect(e.message).toMatch(/STICK/)
    }
    e.capture('A5+'); expect([e.bindings.LIGHT_PUNCH, e.message]).toEqual(['A5+', 'SAVED'])
  })
  it('refuses the fixed system buttons R1 and L3 and keeps listening', () => {
    const e = padEditor()
    focus(e, COMBAT_ACTIONS.indexOf('LIGHT_PUNCH'))
    for (const [code, name] of [['B5', 'R1'], ['B10', 'L3']]) {
      e.capture(code)
      expect([e.bindings.LIGHT_PUNCH, e.state]).toEqual(['B2', 'LISTENING_FOR_KEY']); expect(e.message).toContain(`${name} IS RESERVED`)
    }
  })
  it('derives the combination list with arcade stick labels', () => {
    expect(combinationRows(DEFAULT_PAD_BINDINGS, PAD_RULES.label).map((row) => row.keys)).toEqual(['↓ + ▢ / 🛆 / ✕ / ⭘', '↑ + ▢ / 🛆 / ✕ / ⭘', 'HOLD ↓ / HOLD BACK ← / →'])
  })
})
