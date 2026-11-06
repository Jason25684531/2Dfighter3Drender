import { describe, expect, it } from 'vitest'
import { COMBAT_ACTIONS, combinationRows, CONTROLS_STORAGE_KEY, ControlsEditor, DEFAULT_KEYBOARD_BINDINGS, keyLabel, keyProblem, loadProfiles, RESET_ROW, saveProfiles, type ControlProfiles } from './ControlProfile'

const memory = (value?: string) => { const data = new Map<string, string>(value === undefined ? [] : [[CONTROLS_STORAGE_KEY, value]]); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, v: string) => { data.set(key, v) } } }
const editor = (store = memory()) => new ControlsEditor(loadProfiles(store), (profiles: ControlProfiles) => saveProfiles(profiles, store))
const focus = (e: ControlsEditor, action: number) => { e.focus = action; e.activate() }

describe('control profiles', () => {
  it('defaults P1 to A D / W S / F U G I / Esc and keeps a separate P2 profile', () => {
    expect(loadProfiles(memory()).P1).toEqual({ MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', JUMP: 'KeyW', CROUCH: 'KeyS', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', GUARD: 'KeyC', PAUSE: 'Escape' })
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
  it('keeps an old save without GUARD and fills GUARD with the default C', () => {
    const { GUARD: _guard, ...old } = { ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ' }
    expect(loadProfiles(memory(JSON.stringify({ version: 3, profiles: { P1: old } }))).P1).toMatchObject({ LIGHT_PUNCH: 'KeyQ', GUARD: 'KeyC' })
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
    expect(combinationRows(e.bindings).map((row) => row.keys)).toEqual(['S + Q / U / G / I', 'W + Q / U / G / I', 'C / HOLD BACK A / D'])
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
