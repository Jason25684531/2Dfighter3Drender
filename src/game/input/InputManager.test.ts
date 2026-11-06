import { intentFromInput } from '../combat/CombatWorld'
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
    expect(input.consumeGameplaySnapshot()).toMatchObject({ jumpPressed: false, attack: 'LIGHT_KICK' })
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
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0, attackPressed: false })
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
    expect(input.consumeGameplaySnapshot()).toMatchObject({ jumpPressed: false })
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
    expect(input.consumeGameplaySnapshot()).toMatchObject({ attackPressed: true })
    expect(input.consumeGameplaySnapshot()).toMatchObject({ attackPressed: false })
  })

  it('normalizes gamepad inputs, deadzones analog, and merges devices deterministically', () => {
    const pad: GamepadLike = { buttons: [{ pressed: true }, { pressed: false }, { pressed: true }], axes: [0.625] }
    const input = new InputManager(); input.update([pad])
    expect(input.consumeUiActions()).toEqual(['CONFIRM'])
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0.5, jumpPressed: false, attackPressed: true })
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
  it('tags P1 (WASD/F/K) and P2 (arrows/NUM 1/Backspace, following P2 combat keys) actions without changing the unowned stream', () => {
    const input = new InputManager()
    ;['KeyW', 'KeyF', 'KeyK', 'ArrowLeft', 'Enter', 'Numpad1', 'Backspace'].forEach((code) => input.handleKeyDown(code))
    input.handleKeyDown('KeyW')
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'NAV_UP' }, { owner: 'P1', action: 'CONFIRM' }, { owner: 'P1', action: 'BACK' }, { owner: 'P2', action: 'NAV_LEFT' }, { owner: 'P2', action: 'CONFIRM' }, { owner: 'P2', action: 'BACK' }])
    expect(input.consumeOwnedUiActions()).toEqual([])
    input.update(); expect(input.consumeUiActions().sort()).toEqual(['CONFIRM', 'NAV_LEFT'])
    const custom = new InputManager({ owners: { P1: { CONFIRM: ['Space'] } } }); custom.handleKeyDown('Space'); custom.handleKeyDown('KeyF')
    expect(custom.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM' }])
  })
  it('maps default P1 combat keys (A D / W jump / S crouch / F U G I / Esc) to semantic actions only', () => {
    const input = new InputManager()
    const tap = (code: string) => { input.handleKeyDown(code); input.update(); const snapshot = input.consumeGameplaySnapshot(); input.handleKeyUp(code); input.update(); return snapshot }
    expect(tap('KeyF')).toMatchObject({ attackPressed: true, attack: 'LIGHT_PUNCH' })
    expect(tap('KeyU').attack).toBe('HEAVY_PUNCH'); expect(tap('KeyG').attack).toBe('LIGHT_KICK'); expect(tap('KeyI').attack).toBe('HEAVY_KICK')
    expect(tap('KeyW')).toMatchObject({ jumpPressed: true, attackPressed: false }); expect(tap('KeyW')).not.toHaveProperty('moveZ')
    input.handleKeyDown('KeyS'); input.update(); expect(input.consumeGameplaySnapshot().crouchHeld).toBe(true); input.handleKeyUp('KeyS'); input.update()
    expect(intentFromInput(tap('KeyI'))).toMatchObject({ attackPressed: true, attack: 'HEAVY_KICK' })
    input.handleKeyDown('Escape'); input.update(); expect(input.consumePause()).toBe(true); expect(input.consumePause()).toBe(false)
    // 戰鬥鍵不是選單鍵：F 不會變成 CONFIRM。
    input.consumeUiActions(); input.handleKeyDown('KeyF'); input.update(); expect(input.consumeUiActions()).toEqual([])
    expect(input.lastCombatInput).toEqual({ code: 'KeyF', action: 'LIGHT_PUNCH' })
  })
  it('reports backward as movement and C as a held guard', () => {
    const input = new InputManager()
    input.handleKeyDown('KeyA'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: -1, guardHeld: false })
    input.handleKeyDown('KeyC'); input.update(); expect(intentFromInput(input.consumeGameplaySnapshot())).toMatchObject({ guard: true })
  })
  it('maps the four face buttons to attacks and only D-pad up to jump', () => {
    for (const [button, attack] of [[2, 'LIGHT_PUNCH'], [3, 'HEAVY_PUNCH'], [0, 'LIGHT_KICK'], [1, 'HEAVY_KICK']] as const) {
      const input = new InputManager(), buttons = Array.from({ length: 13 }, (_, index) => ({ pressed: index === button }))
      input.update([{ buttons }]); expect(input.consumeGameplaySnapshot()).toMatchObject({ attack, jumpPressed: false })
    }
    const input = new InputManager(), buttons = Array.from({ length: 13 }, (_, index) => ({ pressed: index === 12 }))
    input.update([{ buttons }]); expect(input.consumeGameplaySnapshot()).toMatchObject({ jumpPressed: true, attackPressed: false })
  })
  it('rebinds Light Punch from F to Q and moves the P1 confirm key with it', () => {
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, LIGHT_PUNCH: 'KeyQ' } })
    input.handleKeyDown('KeyF'); input.update(); expect(input.consumeGameplaySnapshot().attackPressed).toBe(false)
    input.handleKeyDown('KeyQ'); input.update(); expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH')
    // 確認鍵＝輕拳鍵，跟著改到 Q。
    input.handleKeyDown('KeyQ'); expect(input.consumeOwnedUiActions()).toContainEqual({ owner: 'P1', action: 'CONFIRM' })
  })
  it('routes Player 1 menu input through the custom bindings', () => {
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, MOVE_LEFT: 'KeyJ', JUMP: 'KeyT', LIGHT_PUNCH: 'KeyK' } })
    for (const code of ['KeyJ', 'KeyT', 'KeyK', 'KeyW', 'KeyU']) { input.handleKeyDown(code); input.handleKeyUp(code) }
    // 確認＝輕拳（K）→ 返回改用重拳 U；W 不再是上。
    expect(input.consumeOwnedUiActions().filter(({ owner }) => owner === 'P1').map(({ action }) => action)).toEqual(['NAV_LEFT', 'NAV_UP', 'CONFIRM', 'BACK'])
  })

  it('gives a key bound by Player 1 to Player 1 only, so arrows / Enter fire once', () => {
    // 1P 改用方向鍵＋Enter：同一鍵不能再觸發未標記選單鍵（P0／選地圖會派送兩次＝原地不動）或 2P 鍵（Enter 讓 2P 加入）。
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1, MOVE_LEFT: 'ArrowLeft', MOVE_RIGHT: 'ArrowRight', JUMP: 'ArrowUp', CROUCH: 'ArrowDown', LIGHT_PUNCH: 'Enter' } })
    for (const code of ['ArrowLeft', 'Enter']) { input.handleKeyDown(code); input.update(); input.handleKeyUp(code); input.update() }
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'NAV_LEFT' }, { owner: 'P1', action: 'CONFIRM' }])
    expect(input.consumeUiActions()).toEqual([])
    // 1P 沒用到的鍵照舊：Escape 返回、Backspace 給 2P。
    for (const code of ['Escape', 'Backspace']) { input.handleKeyDown(code); input.update(); input.handleKeyUp(code); input.update() }
    expect(input.consumeUiActions()).toEqual(['BACK']); expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P2', action: 'BACK' }])
  })

  it('keeps P1 and P2 gameplay snapshots separate, each consuming its own edges', () => {
    const input = new InputManager()
    input.handleKeyDown('KeyF'); input.handleKeyDown('Numpad2'); input.handleKeyDown('KeyD'); input.handleKeyDown('ArrowLeft'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ attack: 'LIGHT_PUNCH', moveX: 1 })
    expect(input.consumeGameplaySnapshot('P2')).toMatchObject({ attack: 'HEAVY_PUNCH', moveX: -1 })
    input.handleKeyDown('Numpad4'); input.update(); input.consumeGameplaySnapshot()
    expect(input.consumeGameplaySnapshot('P2').attack).toBe('LIGHT_KICK')
    input.handleKeyDown('ArrowDown'); input.update(); expect(input.consumeGameplaySnapshot('P2').crouchHeld).toBe(true); expect(input.consumeGameplaySnapshot().crouchHeld).toBe(false)
  })
  it('applies saved P2 bindings to P2 combat and P2 menu keys', () => {
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2, LIGHT_PUNCH: 'KeyL' } })
    input.handleKeyDown('KeyL'); input.update()
    expect(input.consumeGameplaySnapshot('P2').attack).toBe('LIGHT_PUNCH'); expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P2', action: 'CONFIRM' }])
    input.handleKeyDown('Numpad1'); input.update(); expect(input.consumeGameplaySnapshot('P2').attackPressed).toBe(false)
  })
  it('splits gamepads only in versus and lets either player pause', () => {
    const x = { buttons: [{}, {}, { pressed: true }] }, none = { buttons: [] }
    const solo = new InputManager(); solo.update([none, x])
    expect(solo.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH'); expect(solo.consumeGameplaySnapshot('P2').attackPressed).toBe(false)
    const versus = new InputManager(); versus.setVersus(true); versus.update([none, x])
    expect(versus.consumeGameplaySnapshot().attackPressed).toBe(false); expect(versus.consumeGameplaySnapshot('P2').attack).toBe('LIGHT_PUNCH')
    versus.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2, PAUSE: 'KeyP' } })
    versus.handleKeyDown('KeyP'); versus.update(); expect(versus.consumePause()).toBe(true); expect(versus.consumePause()).toBe(false)
  })
})
