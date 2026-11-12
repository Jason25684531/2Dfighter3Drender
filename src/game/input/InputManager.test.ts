import { intentFromInput } from '../combat/CombatWorld'
import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { FocusManager } from '../ui/FocusManager'
import { NavigationManager } from '../ui/NavigationManager'
import { UIEventBus } from '../ui/UIEventBus'
import { InputManager, type GamepadLike } from './InputManager'
import { DEFAULT_KEYBOARD_BINDINGS } from './ControlProfile'
import { DEFAULT_PAD_BINDINGS } from './GamepadProfile'

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
    // 0.625 已過 0.5 按下門檻：類比同時算一次 NAV_RIGHT，moveX 仍走 0.25 deadzone 正規化。
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'NAV_RIGHT', device: 'gamepad' }, { owner: 'P1', action: 'CONFIRM', device: 'gamepad' }]); expect(input.consumeUiActions()).toEqual([])
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0.5, jumpPressed: false, attackPressed: true })
    const deadzone = new InputManager(); deadzone.update([{ axes: [0.2] }]); expect(deadzone.consumeGameplaySnapshot().moveX).toBe(0)
    const tie = new InputManager(); tie.handleKeyDown('KeyA'); tie.update([{ axes: [1] }]); expect(tie.consumeGameplaySnapshot().moveX).toBe(-1)
  })

  it('does not repeat a held gamepad UI press across render updates', () => {
    const input = new InputManager(); const pad: GamepadLike = { buttons: [{ pressed: true }] }
    input.update([pad]); expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM', device: 'gamepad' }])
    input.update([pad]); input.update([pad]); expect(input.consumeOwnedUiActions()).toEqual([])
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
  it('reports backward as movement, holding down as guard, and C as nothing', () => {
    const input = new InputManager()
    input.handleKeyDown('KeyA'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: -1, guardHeld: false })
    input.handleKeyUp('KeyA'); input.handleKeyDown('KeyC'); input.update()
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0, guardHeld: false, crouchHeld: false, attackPressed: false })
    input.handleKeyDown('KeyS'); input.update(); expect(intentFromInput(input.consumeGameplaySnapshot())).toMatchObject({ guard: true })
    // 按住下＋攻擊：snapshot 同時帶攻擊與防禦，出招優先由 CombatWorld 決定。
    input.handleKeyDown('KeyF'); input.update(); expect(input.consumeGameplaySnapshot()).toMatchObject({ attack: 'LIGHT_PUNCH', guardHeld: true })
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
  it('lets either player pause with their own keyboard pause key', () => {
    const input = new InputManager()
    input.setCombatBindings({ ...DEFAULT_KEYBOARD_BINDINGS, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2, PAUSE: 'KeyP' } })
    input.handleKeyDown('KeyP'); input.update(); expect(input.consumePause()).toBe(true); expect(input.consumePause()).toBe(false)
  })
})

const pad = (pressed: number[] = [], axes: number[] = []): GamepadLike => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })), axes: [0, 0, 0, 0].map((zero, i) => axes[i] ?? zero) })
/** 依序讓每個 index 按一下沒有任何作用的 SHARE（8）取得所有權，清掉取得過程的邊緣。 */
const owned = (count = 1): InputManager => {
  const input = new InputManager(), idle = Array.from({ length: count }, () => pad())
  for (let i = 0; i < count; i += 1) { input.update(idle.map((p, j) => (j === i ? pad([8]) : p))); input.update(idle) }
  input.consumeOwnedUiActions(); input.consumeGameplaySnapshot(); input.consumeGameplaySnapshot('P2')
  return input
}
const players = (input: InputManager) => ({ P1: input.consumeGameplaySnapshot(), P2: input.consumeGameplaySnapshot('P2') })

describe('InputManager gamepad ownership', () => {
  it('claims P1 with the first press, which still counts, and keeps the second pad for P2', () => {
    const input = new InputManager()
    input.update([null, pad([0])])
    expect([input.padOwner('P1'), input.padOwner('P2')]).toEqual([1, undefined])
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM', device: 'gamepad' }])
    expect(players(input)).toMatchObject({ P1: { attack: 'LIGHT_KICK' }, P2: { attackPressed: false } })
    input.update([pad([2]), pad()])
    expect([input.padOwner('P1'), input.padOwner('P2')]).toEqual([1, 0])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false }, P2: { attack: 'LIGHT_PUNCH' } })
  })
  it('keeps simultaneous presses and directions on two pads apart', () => {
    const input = owned(2)
    input.update([pad([15, 1]), pad([14, 2])])
    expect(players(input)).toMatchObject({ P1: { moveX: 1, attack: 'HEAVY_KICK' }, P2: { moveX: -1, attack: 'LIGHT_PUNCH' } })
  })
  it('never lets a pad owned by P2 drive P1, even when P1 has no pad', () => {
    const input = owned(2)
    input.update([null, pad([2, 15])])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false, moveX: 0 }, P2: { attack: 'LIGHT_PUNCH', moveX: 1 } })
  })
  it('reads pads by Gamepad.index, so unplugging 1P never hands its pad to 2P', () => {
    const input = owned(2)
    expect(input.update([null, pad()])).toEqual(['P1'])
    expect([input.padOwner('P1'), input.padOwner('P2')]).toEqual([undefined, 1])
    input.update([null, pad([3])])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false }, P2: { attack: 'HEAVY_PUNCH' } })
  })
  it('gives a third pad nothing while both players own one', () => {
    const input = owned(2)
    input.update([pad(), pad(), pad([0, 2, 15])])
    expect([input.padOwner('P1'), input.padOwner('P2')]).toEqual([0, 1])
    expect(input.consumeOwnedUiActions()).toEqual([]); expect(input.consumeUiActions()).toEqual([])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false, moveX: 0 }, P2: { attackPressed: false, moveX: 0 } })
  })
  it('fires only the claiming press when a waiting pad that already holds a button takes a freed slot', () => {
    const input = owned(2)
    input.update([pad(), pad(), pad([0])]); input.update([null, pad(), pad([0])])
    expect(input.padOwner('P1')).toBeUndefined()
    input.update([null, pad(), pad([0, 2])])
    expect(input.padOwner('P1')).toBe(2)
    expect(input.consumeOwnedUiActions()).toEqual([])
    expect(input.getActionState('LIGHT_KICK').pressed).toBe(false)
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH')
  })
})

describe('InputManager gamepad directions', () => {
  it('accepts the D-pad, left stick and right stick for every direction', () => {
    for (const up of [pad([12]), pad([], [0, -1]), pad([], [0, 0, 0, -1])]) { const input = owned(); input.update([up]); expect(input.consumeGameplaySnapshot().jumpPressed).toBe(true) }
    for (const down of [pad([13]), pad([], [0, 1]), pad([], [0, 0, 0, 1])]) { const input = owned(); input.update([down]); expect(input.consumeGameplaySnapshot()).toMatchObject({ crouchHeld: true, guardHeld: true }) }
    for (const [held, moveX] of [[pad([14]), -1], [pad([15]), 1], [pad([], [-1]), -1], [pad([], [0, 0, 1]), 1]] as const) { const input = owned(); input.update([held]); expect(input.consumeGameplaySnapshot().moveX).toBe(moveX) }
  })
  it('emits a stick jump press once and then holds crouch', () => {
    const input = owned()
    input.update([pad([], [0, -1])]); input.update([pad([], [0, -1])])
    expect(input.consumeGameplaySnapshot().jumpPressed).toBe(true); expect(input.consumeGameplaySnapshot().jumpPressed).toBe(false)
    input.update([pad([], [0, 1])]); expect(input.consumeGameplaySnapshot()).toMatchObject({ jumpPressed: false, crouchHeld: true })
  })
  it('does not chatter at the 0.5 / 0.35 boundary', () => {
    const input = owned(), states = [-0.6, -0.45, -0.52, -0.45, -0.3].map((y) => { input.update([pad([], [0, y])]); return input.getActionState('JUMP') })
    expect(states.map((state) => state.pressed)).toEqual([true, false, false, false, false])
    expect(states.map((state) => state.held)).toEqual([true, true, true, true, false])
    expect(states[4].released).toBe(true)
    const below = owned(); below.update([pad([], [0, -0.45])]); expect(below.getActionState('JUMP').held).toBe(false)
  })
  it('keeps the 0.25 deadzone scaling for analog movement', () => {
    const input = owned()
    input.update([pad([], [0.625])]); expect(input.consumeGameplaySnapshot().moveX).toBe(0.5)
    input.update([pad([], [0, 0, -0.2])]); expect(input.consumeGameplaySnapshot().moveX).toBe(0)
  })
})

describe('InputManager gamepad UI actions', () => {
  it('tags owned pad presses with their owner and never adds them to the untagged stream', () => {
    const input = owned(2)
    input.update([pad(), pad([14])])
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P2', action: 'NAV_LEFT', device: 'gamepad' }]); expect(input.consumeUiActions()).toEqual([])
    input.update([pad([5]), pad([], [0, 1])])
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'BACK', device: 'gamepad' }, { owner: 'P2', action: 'NAV_DOWN', device: 'gamepad' }])
  })
  it('goes back with R1 only: heavy kick (⭘) has no menu role but still kicks', () => {
    const input = owned(2)
    input.update([pad([1]), pad([1])])
    expect(input.consumeOwnedUiActions()).toEqual([])
    expect(players(input)).toMatchObject({ P1: { attack: 'HEAVY_KICK' }, P2: { attack: 'HEAVY_KICK' } })
    input.update([pad([1, 5]), pad([5])]); input.update([pad([5]), pad([5])])
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'BACK', device: 'gamepad' }, { owner: 'P2', action: 'BACK', device: 'gamepad' }])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false }, P2: { attackPressed: false } })
  })
  it('reports a fresh L3 press per player for opening the controls panel, without a menu action', () => {
    const input = owned(2)
    input.update([pad(), pad([10])])
    expect([input.controlsPress('P1'), input.controlsPress('P2')]).toEqual([false, true])
    input.update([pad([10]), pad([10])])
    expect([input.controlsPress('P1'), input.controlsPress('P2')]).toEqual([true, false])
    input.update([pad([10]), pad([10])])
    expect([input.controlsPress('P1'), input.controlsPress('P2')]).toEqual([false, false])
    expect(input.consumeOwnedUiActions()).toEqual([]); expect(input.consumeUiActions()).toEqual([])
  })
  it('emits one confirm for a held button and one more only after release', () => {
    const input = owned()
    for (const pressed of [[0], [0], [0], [], [0]]) input.update([pad(pressed)])
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM', device: 'gamepad' }, { owner: 'P1', action: 'CONFIRM', device: 'gamepad' }])
  })
  it('emits a single press when the keyboard and the pad hit the same action in one frame', () => {
    const input = owned()
    input.handleKeyDown('KeyF'); input.update([pad([2])])
    expect(input.getActionState('LIGHT_PUNCH').pressed).toBe(true)
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH'); expect(input.consumeGameplaySnapshot().attackPressed).toBe(false)
  })
})

describe('InputManager gamepad disconnect', () => {
  it('releases held input without a new edge and drops the player\'s unconsumed edges', () => {
    const input = owned(2)
    input.update([pad([15, 2]), pad([3])]); input.consumeGameplaySnapshot('P2')
    expect(input.update([null, pad([3])])).toEqual(['P1'])
    expect(input.consumeGameplaySnapshot()).toMatchObject({ moveX: 0, attackPressed: false })
    expect(input.getActionState('MOVE_RIGHT')).toEqual({ pressed: false, held: false, released: true })
    expect(input.consumeOwnedUiActions().filter(({ owner }) => owner === 'P1')).toEqual([])
    expect(input.getActionState('HEAVY_PUNCH', 'P2').held).toBe(true)
  })
  it('needs a fresh press after reconnecting, and does not replay a button held before the unplug', () => {
    const input = owned()
    input.update([pad([2])]); input.consumeGameplaySnapshot(); input.update([null])
    input.update([pad()])
    expect(input.padOwner('P1')).toBeUndefined()
    input.update([pad([0])])
    expect(input.padOwner('P1')).toBe(0); expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_KICK')
  })
  it('does not replay an attack held through an unplug until it is actually pressed again', () => {
    const input = owned()
    input.update([pad([2])]); input.consumeGameplaySnapshot(); input.update([null])
    input.update([pad([2])])
    expect(input.padOwner('P1')).toBeUndefined()
    input.update([pad([2, 0])])
    expect(input.padOwner('P1')).toBe(0)
    expect(input.getActionState('LIGHT_PUNCH').pressed).toBe(false)
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_KICK')
    input.update([pad([0])]); input.update([pad([0, 2])])
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH')
  })
  it('keeps a pad attack pressed and released between two 24Hz ticks for exactly one snapshot', () => {
    const input = owned()
    input.update([pad([2])]); input.update([pad()])
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH'); expect(input.consumeGameplaySnapshot().attackPressed).toBe(false)
  })
})

describe('InputManager gamepad bindings', () => {
  it('applies each player\'s saved pad bindings, moving confirm with Light Kick', () => {
    const input = owned(2)
    input.setPadBindings({ P1: { ...DEFAULT_PAD_BINDINGS, LIGHT_PUNCH: 'B4', LIGHT_KICK: 'B6' }, P2: DEFAULT_PAD_BINDINGS })
    input.update([pad([2]), pad([2])])
    expect(players(input)).toMatchObject({ P1: { attackPressed: false }, P2: { attack: 'LIGHT_PUNCH' } })
    input.update([pad([4, 6]), pad()])
    expect(input.consumeGameplaySnapshot().attack).toBe('LIGHT_PUNCH')
    expect(input.consumeOwnedUiActions()).toEqual([{ owner: 'P1', action: 'CONFIRM', device: 'gamepad' }])
    input.update([pad([0]), pad()]); expect(input.consumeOwnedUiActions()).toEqual([])
  })
  it('captures the next fresh press from the asking player\'s own pad only', () => {
    const input = owned(2)
    input.update([pad([7]), pad()])
    expect([input.padPress('P1'), input.padPress('P2')]).toEqual(['B7', undefined])
    input.update([pad([7]), pad([], [0, 0, 0, 1])])
    expect([input.padPress('P1'), input.padPress('P2')]).toEqual([undefined, 'A3+'])
  })
})
