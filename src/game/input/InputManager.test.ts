import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { FocusManager } from '../ui/FocusManager'
import { NavigationManager } from '../ui/NavigationManager'
import { UIEventBus } from '../ui/UIEventBus'
import { InputManager, type GamepadLike } from './InputManager'
import { DEFAULT_KEYBOARD_BINDINGS } from './ControlProfile'

describe('InputManager', () => {
  it('tracks device switches without changing gameplay input or letting held pad input steal keyboard emphasis', () => {
    const input = new InputManager(), pad = { buttons: [{ pressed: true }] }
    expect(input.lastDevice()).toBe('keyboard'); input.update([pad]); expect(input.lastDevice()).toBe('gamepad')
    expect(input.consumeGameplaySnapshot().jumpPressed).toBe(true)
    input.handleKeyDown('KeyF'); input.update([pad]); expect(input.lastDevice()).toBe('keyboard')
    expect(input.consumeGameplaySnapshot().attackPressed).toBe(true)
    input.update([{ buttons: [{ pressed: true }, { pressed: true }] }]); expect(input.lastDevice()).toBe('gamepad')
    input.handleKeyDown('KeyD'); input.update([{ buttons: [{ pressed: true }, { pressed: true }] }]); expect(input.lastDevice()).toBe('keyboard')
    input.update([{ buttons: [{ pressed: true }], axes: [-1] }]); expect(input.lastDevice()).toBe('gamepad')
    input.update([]); input.update([pad]); expect(input.lastDevice()).toBe('gamepad')
  })
  it('releases held keys and pending edges on blur, then accepts a fresh press and detaches', () => {
    const input = new InputManager()
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    input.attachKeyboard(target)
    const blur = target.addEventListener.mock.calls.find(([type]) => type === 'blur')![1]
    input.handleKeyDown('KeyD'); input.handleKeyDown('KeyF'); input.handleKeyDown('Enter'); input.update()
    blur(); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0, attackPressed: false, attackHeld: false })
    expect(input.getActionState('LIGHT_PUNCH')).toEqual({ pressed: false, held: false, released: true })
    expect(input.consumeUiActions()).toEqual([])
    input.handleKeyDown('KeyF'); input.update()
    expect(input.consumeGameplaySnapshot().attackPressed).toBe(true)
    input.detachKeyboard()
    expect(target.removeEventListener.mock.calls).toHaveLength(3)
    target.addEventListener.mock.calls.forEach((call) => expect(target.removeEventListener.mock.calls).toContainEqual(call))
  })

  it('does not synthesize a fresh gamepad edge when keyboard focus is lost', () => {
    const input = new InputManager()
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    input.attachKeyboard(target)
    const pad = { buttons: [{ pressed: true }] }
    input.update([pad]); input.consumeGameplaySnapshot(); input.consumeUiActions()
    target.addEventListener.mock.calls.find(([type]) => type === 'blur')![1]()
    input.update([pad])
    expect(input.consumeGameplaySnapshot()).toMatchObject({ jumpPressed: false, jumpHeld: true })
    expect(input.consumeUiActions()).toEqual([])
  })

  it('maps keyboard states and exposes one-shot edges', () => {
    const input = new InputManager()
    input.handleKeyDown('Enter'); input.update()
    expect(input.getActionState('CONFIRM')).toEqual({ pressed: true, held: true, released: false })
    expect(input.consumeUiActions()).toEqual(['CONFIRM']); expect(input.consumeUiActions()).toEqual([])
    input.update(); expect(input.getActionState('CONFIRM')).toEqual({ pressed: false, held: true, released: false })
    input.handleKeyUp('Enter'); input.update(); expect(input.getActionState('CONFIRM')).toEqual({ pressed: false, held: false, released: true })
  })

  it('buffers a complete attack press between ticks and consumes it once', () => {
    const input = new InputManager()
    input.handleKeyDown('KeyF'); input.handleKeyUp('KeyF'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ attackPressed: true, attackHeld: false })
    expect(input.consumeGameplaySnapshot()).toMatchObject({ attackPressed: false, attackHeld: false })
  })

  it('normalizes gamepad inputs, deadzones analog, and merges devices deterministically', () => {
    const pad: GamepadLike = { buttons: [{ pressed: true }, { pressed: false }, { pressed: true }], axes: [0.625] }
    const input = new InputManager(); input.update([pad])
    expect(input.consumeUiActions()).toEqual(['CONFIRM'])
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0.5, jumpPressed: true, attackPressed: true })
    const deadzone = new InputManager(); deadzone.update([{ axes: [0.2] }]); expect(deadzone.consumeGameplaySnapshot().moveX).toBe(0)
    const tie = new InputManager(); tie.handleKeyDown('KeyA'); tie.update([{ axes: [1] }]); expect(tie.consumeGameplaySnapshot().moveX).toBe(-1)
  })

  it('does not repeat a held gamepad UI press across render updates', () => {
    const input = new InputManager(); const pad: GamepadLike = { buttons: [{ pressed: true }] }
    input.update([pad]); expect(input.consumeUiActions()).toEqual(['CONFIRM'])
    input.update([pad]); expect(input.consumeUiActions()).toEqual([])
  })

  it('routes semantic UI actions through NavigationManager and focus', () => {
    const events = new UIEventBus(); const app = new AppStateMachine(); const focus = new FocusManager(events); const nav = new NavigationManager(app, focus, events)
    let activated = 0; focus.register('menu', 'confirm', true, () => { activated += 1 }); focus.activate('menu')
    const input = new InputManager(); input.handleKeyDown('Enter'); input.update(); input.consumeUiActions().forEach((action) => nav.dispatch(action));
    expect(activated).toBe(1); expect(app.getCurrentState()).toBe(AppState.IDLE)
    ;[AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE].forEach((state) => app.transitionTo(state))
    input.handleKeyDown('Escape'); input.update(); input.consumeUiActions().forEach((action) => nav.dispatch(action)); expect(nav.isOverlayOpen()).toBe(true)
  })
  it('tags P1 (WASD/J/K) and P2 (arrows/Enter/Backspace) actions without changing the unowned stream', () => {
    const input = new InputManager()
    ;['KeyW', 'KeyJ', 'KeyK', 'ArrowLeft', 'Enter', 'Backspace'].forEach((code) => input.handleKeyDown(code))
    input.handleKeyDown('KeyW')
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'NAV_UP' }, { owner: 'P1', action: 'CONFIRM' }, { owner: 'P1', action: 'BACK' }, { owner: 'P2', action: 'NAV_LEFT' }, { owner: 'P2', action: 'CONFIRM' }, { owner: 'P2', action: 'BACK' }])
    expect(input.consumeOwnedUiActions()).toEqual([])
    input.update(); expect(input.consumeUiActions().sort()).toEqual(['CONFIRM', 'NAV_LEFT'])
    const custom = new InputManager({ owners: { P1: { CONFIRM: ['Space'] } } }); custom.handleKeyDown('Space'); custom.handleKeyDown('KeyJ')
    expect(custom.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM' }])
  })
  it('maps default P1 combat keys (WASD / Space X / F U G I / Esc) to semantic actions only', () => {
    const input = new InputManager()
    const tap = (code: string) => { input.handleKeyDown(code); input.update(); const snapshot = input.consumeGameplaySnapshot(); input.handleKeyUp(code); input.update(); return snapshot }
    expect(tap('KeyF')).toMatchObject({ attackPressed: true, attack: 'LIGHT_PUNCH' })
    expect(tap('KeyU').attack).toBe('HEAVY_PUNCH'); expect(tap('KeyG').attack).toBe('LIGHT_KICK'); expect(tap('KeyI').attack).toBe('HEAVY_KICK')
    expect(tap('Space')).toMatchObject({ jumpPressed: true, attackPressed: false })
    input.handleKeyDown('KeyX'); input.update(); expect(input.consumeGameplaySnapshot().crouchHeld).toBe(true); input.handleKeyUp('KeyX')
    // W/S 是縱深，不是跳／蹲。
    expect(tap('KeyW')).toMatchObject({ moveZ: 1, jumpPressed: false }); expect(tap('KeyS')).toMatchObject({ moveZ: -1, crouchHeld: false })
    input.handleKeyDown('Escape'); input.update(); expect(input.consumePause()).toBe(true); expect(input.consumePause()).toBe(false)
    // 戰鬥鍵不是選單鍵：F 不會變成 CONFIRM。
    input.consumeUiActions(); input.handleKeyDown('KeyF'); input.update(); expect(input.consumeUiActions()).toEqual([])
    expect(input.lastCombatInput).toEqual({ code: 'KeyF', action: 'LIGHT_PUNCH' })
  })
  it('uses a dedicated GUARD key; moving backward only walks', () => {
    const input = new InputManager()
    input.handleKeyDown('KeyA'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: -1, guardHeld: false })
    input.handleKeyDown('KeyK'); input.update(); expect(input.consumeGameplaySnapshot().guardHeld).toBe(true)
    input.handleKeyUp('KeyK'); input.update(); expect(input.consumeGameplaySnapshot().guardHeld).toBe(false)
  })
  it('rebinds Light Punch from F to Q without touching menu or owner keys', () => {
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ' })
    input.handleKeyDown('KeyF'); input.update(); expect(input.consumeGameplaySnapshot().attackPressed).toBe(false)
    input.handleKeyDown('KeyQ'); input.update(); expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH')
    input.handleKeyDown('KeyJ'); expect(input.consumeOwnedUiActions()).toContainEqual({ owner: 'P1', action: 'CONFIRM' })
  })
})
