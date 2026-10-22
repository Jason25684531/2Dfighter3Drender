import { describe, expect, it } from 'vitest'
import { CONTROLS_STORAGE_KEY, ControlsEditor, DEFAULT_KEYBOARD_BINDINGS, keyLabel, keyProblem, loadProfiles, RESET_ROW, saveProfiles, type ControlProfiles } from './ControlProfile'

const memory = (value?: string) => { const data = new Map<string, string>(value === undefined ? [] : [[CONTROLS_STORAGE_KEY, value]]); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, v: string) => { data.set(key, v) } } }
const editor = (store = memory()) => new ControlsEditor(loadProfiles(store), (profiles: ControlProfiles) => saveProfiles(profiles, store))
const focus = (e: ControlsEditor, action: number) => { e.focus = action; e.activate() }

describe('control profiles', () => {
  it('defaults P1 to WASD / Space X / F U G I / Esc and keeps a separate P2 profile', () => {
    expect(loadProfiles(memory()).P1).toEqual({ MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', MOVE_UP: 'KeyW', MOVE_DOWN: 'KeyS', JUMP: 'Space', CROUCH: 'KeyX', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', GUARD: 'KeyK', PAUSE: 'Escape' })
    expect(loadProfiles(memory()).P2.LIGHT_PUNCH).toBe('Numpad1')
    expect(['KeyA', 'ArrowLeft', 'Escape', 'Space', 'Numpad1', 'Digit3'].map(keyLabel)).toEqual(['A', '←', 'ESC', 'SPACE', 'NUM 1', '3'])
  })
  it('persists a custom binding and reloads it', () => {
    const store = memory(), e = editor(store)
    focus(e, 6); e.capture('KeyQ')
    expect(e.message).toBe('SAVED'); expect(e.bindings.LIGHT_PUNCH).toBe('KeyQ')
    expect(loadProfiles(store).P1.LIGHT_PUNCH).toBe('KeyQ')
    expect(JSON.parse(store.getItem(CONTROLS_STORAGE_KEY)!).version).toBe(1)
  })
  it('falls back to defaults for corrupted, wrong-version, incomplete, or duplicate data and refuses to save them', () => {
    for (const bad of ['{not json', JSON.stringify({ version: 2, profiles: { P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyZ' } } }), JSON.stringify({ version: 1, profiles: { P1: { MOVE_LEFT: 'KeyA' } } }), JSON.stringify({ version: 1, profiles: { P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyF' } } })])
      expect(loadProfiles(memory(bad))).toEqual(DEFAULT_KEYBOARD_BINDINGS)
    const store = memory()
    expect(saveProfiles({ ...DEFAULT_KEYBOARD_BINDINGS, P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, JUMP: 'KeyF' } }, store)).toBe(false)
    expect(store.getItem(CONTROLS_STORAGE_KEY)).toBeNull()
  })
  it('detects a conflict and swaps so no action is left unbound', () => {
    const e = editor()
    focus(e, 4); e.capture('KeyF')
    expect(e.state).toBe('CONFLICT'); expect(e.message).toBe('F IS ALREADY ASSIGNED TO LIGHT PUNCH'); expect(e.bindings.JUMP).toBe('Space')
    e.activate() // SWAP 為預設
    expect([e.bindings.JUMP, e.bindings.LIGHT_PUNCH]).toEqual(['KeyF', 'Space'])
  })
  it('cancels a conflict, a capture (Escape, also while rebinding Pause), and rejects invalid keys', () => {
    const e = editor()
    focus(e, 4); e.capture('KeyF'); e.move(1); e.activate()
    expect([e.state, e.bindings.JUMP, e.bindings.LIGHT_PUNCH]).toEqual(['SELECT_BINDING', 'Space', 'KeyF'])
    focus(e, 11); e.capture('Escape'); expect([e.state, e.bindings.PAUSE]).toEqual(['SELECT_BINDING', 'Escape'])
    focus(e, 0)
    for (const code of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', 'Tab', 'F5', 'F12']) { e.capture(code); expect(e.bindings.MOVE_LEFT).toBe('KeyA') }
    expect(e.state).toBe('LISTENING_FOR_KEY'); expect(e.message).toMatch(/RESERVED/)
    expect(keyProblem('ShiftLeft')).toMatch(/MODIFIER/)
    expect(e.back()).toBe(false); expect(e.back()).toBe(true)
  })
  it('resets all P1 controls only after confirmation', () => {
    const store = memory(), e = editor(store)
    focus(e, 6); e.capture('KeyQ')
    focus(e, RESET_ROW); expect(e.state).toBe('CONFIRM_RESET')
    e.move(1); e.activate(); expect(e.bindings.LIGHT_PUNCH).toBe('KeyQ')
    focus(e, RESET_ROW); e.activate()
    expect(e.bindings).toEqual(DEFAULT_KEYBOARD_BINDINGS.P1); expect(loadProfiles(store).P1).toEqual(DEFAULT_KEYBOARD_BINDINGS.P1)
    expect(e.bindings).not.toBe(DEFAULT_KEYBOARD_BINDINGS.P1)
  })
})
