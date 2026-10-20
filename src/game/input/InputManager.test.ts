import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { FocusManager } from '../ui/FocusManager'
import { NavigationManager } from '../ui/NavigationManager'
import { UIEventBus } from '../ui/UIEventBus'
import { InputManager, type GamepadLike } from './InputManager'

describe('InputManager', () => {
  it('tracks device switches without changing gameplay input or letting held pad input steal keyboard emphasis', () => {
    const input = new InputManager(), pad = { buttons: [{ pressed: true }] }
    expect(input.lastDevice()).toBe('keyboard'); input.update([pad]); expect(input.lastDevice()).toBe('gamepad')
    expect(input.consumeGameplaySnapshot().jumpPressed).toBe(true)
    input.handleKeyDown('KeyJ'); input.update([pad]); expect(input.lastDevice()).toBe('keyboard')
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
    input.handleKeyDown('KeyD'); input.handleKeyDown('KeyJ'); input.handleKeyDown('Enter'); input.update()
    blur(); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0, attackPressed: false, attackHeld: false })
    expect(input.getActionState('ATTACK')).toEqual({ pressed: false, held: false, released: true })
    expect(input.consumeUiActions()).toEqual([])
    input.handleKeyDown('KeyJ'); input.update()
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
    input.handleKeyDown('KeyJ'); input.handleKeyUp('KeyJ'); input.update()
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
})
