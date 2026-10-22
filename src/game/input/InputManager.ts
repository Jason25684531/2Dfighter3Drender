import { ATTACK_ACTIONS, COMBAT_ACTIONS, DEFAULT_KEYBOARD_BINDINGS, type AttackAction, type Bindings, type CombatAction } from './ControlProfile'

export const UI_ACTIONS = ['NAV_UP', 'NAV_DOWN', 'NAV_LEFT', 'NAV_RIGHT', 'CONFIRM', 'BACK', 'OPEN_MENU'] as const
export const GAMEPLAY_ACTIONS = COMBAT_ACTIONS
export type UIAction = (typeof UI_ACTIONS)[number]
export type GameplayAction = CombatAction
export type InputAction = UIAction | GameplayAction

export type InputSnapshot = {
  moveX: number
  moveZ: number
  jumpPressed: boolean
  jumpHeld: boolean
  attackPressed: boolean
  attackHeld: boolean
  guardHeld: boolean
  // 以下只供呈現解析；Combat intent 只讀上面的欄位。
  attack?: AttackAction
  crouchHeld: boolean
}

export type InputState = { pressed: boolean; held: boolean; released: boolean }
export type GamepadButtonLike = { pressed?: boolean; value?: number }
export type GamepadLike = { buttons?: readonly GamepadButtonLike[]; axes?: readonly number[]; connected?: boolean }
export type KeyboardTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type PlayerSlotId = 'P1' | 'P2'
export type OwnedUiAction = Exclude<UIAction, 'OPEN_MENU'>
export type OwnedInput = { owner: PlayerSlotId; action: OwnedUiAction }
type OwnerKeys = Partial<Record<OwnedUiAction, readonly string[]>>

export type InputConfig = {
  keyboard?: Partial<Record<InputAction, readonly string[]>>
  owners?: Partial<Record<PlayerSlotId, OwnerKeys>>
  gamepad?: Partial<Record<InputAction, readonly number[]>>
  axis?: number
  deadzone?: number
}

function combatKeys(bindings: Bindings): Record<CombatAction, readonly string[]> { return Object.fromEntries(COMBAT_ACTIONS.map((action): [CombatAction, string[]] => [action, [bindings[action]]])) as unknown as Record<CombatAction, readonly string[]> }

const defaults: Record<InputAction, readonly string[]> = {
  NAV_UP: ['ArrowUp'], NAV_DOWN: ['ArrowDown'], NAV_LEFT: ['ArrowLeft'], NAV_RIGHT: ['ArrowRight'],
  CONFIRM: ['Enter'], BACK: ['Escape'], OPEN_MENU: ['KeyM'],
  ...combatKeys(DEFAULT_KEYBOARD_BINDINGS.P1),
}
// P1 選角的雙玩家鍵位；與上方未標記鍵位並存，不取代任何既有行為。
const ownerDefaults: Record<PlayerSlotId, OwnerKeys> = {
  P1: { NAV_UP: ['KeyW'], NAV_DOWN: ['KeyS'], NAV_LEFT: ['KeyA'], NAV_RIGHT: ['KeyD'], CONFIRM: ['KeyJ'], BACK: ['KeyK'] },
  P2: { NAV_UP: ['ArrowUp'], NAV_DOWN: ['ArrowDown'], NAV_LEFT: ['ArrowLeft'], NAV_RIGHT: ['ArrowRight'], CONFIRM: ['Enter'], BACK: ['Backspace'] },
}
const defaultGamepad: Record<InputAction, readonly number[]> = {
  NAV_UP: [12], NAV_DOWN: [13], NAV_LEFT: [14], NAV_RIGHT: [15], CONFIRM: [0], BACK: [1], OPEN_MENU: [9],
  MOVE_LEFT: [14], MOVE_RIGHT: [15], MOVE_UP: [12], MOVE_DOWN: [13], JUMP: [0], CROUCH: [6], LIGHT_PUNCH: [2], HEAVY_PUNCH: [3], LIGHT_KICK: [4], HEAVY_KICK: [5], GUARD: [7], PAUSE: [9],
}

const isUi = (action: InputAction): action is UIAction => (UI_ACTIONS as readonly string[]).includes(action)

export class InputManager {
  private readonly config: Required<Pick<InputConfig, 'axis' | 'deadzone'>> & { keyboard: Record<InputAction, readonly string[]>; gamepad: Record<InputAction, readonly number[]> }
  private readonly keys = new Set<string>()
  private readonly keyPressed = new Set<string>()
  private readonly keyReleased = new Set<string>()
  private readonly states = new Map<InputAction, InputState>([...UI_ACTIONS, ...GAMEPLAY_ACTIONS].map((action) => [action, { pressed: false, held: false, released: false }]))
  private readonly pendingUi = new Set<UIAction>()
  private readonly pendingGameplay = new Set<GameplayAction>()
  private readonly pendingOwned: OwnedInput[] = []
  private readonly ownerKeys: Record<PlayerSlotId, OwnerKeys>
  private keyboardTarget?: KeyboardTarget
  private device: 'keyboard' | 'gamepad' = 'keyboard'
  private padInputs = new Set<string>()
  /** 最後一次映射到戰鬥動作的實體鍵（DEV 診斷用）。 */
  lastCombatInput?: { code: string; action: CombatAction }
  lastDevice(): 'keyboard' | 'gamepad' { return this.device }
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event.code)
  private readonly onKeyUp = (event: KeyboardEvent): void => this.handleKeyUp(event.code)
  private readonly onBlur = (): void => {
    this.keys.forEach((code) => this.keyReleased.add(code))
    this.keys.clear(); this.keyPressed.clear(); this.pendingUi.clear(); this.pendingGameplay.clear(); this.pendingOwned.length = 0
  }

  constructor(config: InputConfig = {}) {
    this.config = {
      axis: config.axis ?? 0,
      deadzone: config.deadzone ?? 0.25,
      keyboard: Object.fromEntries((Object.keys(defaults) as InputAction[]).map((action) => [action, config.keyboard?.[action] ?? defaults[action]])) as Record<InputAction, readonly string[]>,
      gamepad: Object.fromEntries((Object.keys(defaultGamepad) as InputAction[]).map((action) => [action, config.gamepad?.[action] ?? defaultGamepad[action]])) as Record<InputAction, readonly number[]>,
    }
    this.ownerKeys = { P1: { ...ownerDefaults.P1, ...config.owners?.P1 }, P2: { ...ownerDefaults.P2, ...config.owners?.P2 } }
  }

  attachKeyboard(target: KeyboardTarget): void {
    this.detachKeyboard(); this.keyboardTarget = target
    target.addEventListener('keydown', this.onKeyDown); target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.onBlur)
  }

  detachKeyboard(): void {
    if (!this.keyboardTarget) return
    this.keyboardTarget.removeEventListener('blur', this.onBlur)
    this.keyboardTarget.removeEventListener('keydown', this.onKeyDown); this.keyboardTarget.removeEventListener('keyup', this.onKeyUp); this.keyboardTarget = undefined
  }

  handleKeyDown(code: string): void {
    this.device = 'keyboard'
    if (!this.keys.has(code)) {
      this.keyPressed.add(code)
      const action = COMBAT_ACTIONS.find((candidate) => this.config.keyboard[candidate].includes(code))
      if (action) this.lastCombatInput = { code, action }
      ;(Object.entries(this.ownerKeys) as [PlayerSlotId, OwnerKeys][]).forEach(([owner, keys]) => (Object.entries(keys) as [OwnedUiAction, readonly string[]][]).forEach(([action, codes]) => { if (codes.includes(code)) this.pendingOwned.push({ owner, action }) }))
    }
    this.keys.add(code)
  }
  handleKeyUp(code: string): void { if (this.keys.delete(code)) this.keyReleased.add(code) }

  update(gamepads: readonly GamepadLike[] = []): void {
    const pads = gamepads.filter((pad) => pad.connected !== false)
    const padInputs = new Set<string>()
    pads.forEach((pad, p) => {
      pad.buttons?.forEach((button, b) => { if (button.pressed || (button.value ?? 0) >= 0.5) padInputs.add(`${p}:button:${b}`) })
      pad.axes?.forEach((axis, a) => { if (Math.abs(axis) > this.config.deadzone) padInputs.add(`${p}:axis:${a}:${Math.sign(axis)}`) })
    })
    if ([...padInputs].some((input) => !this.padInputs.has(input))) this.device = 'gamepad'
    this.padInputs = padInputs
    const keyboardHeld = (action: InputAction): boolean => this.config.keyboard[action].some((code) => this.keys.has(code))
    const keyboardPressed = (action: InputAction): boolean => this.config.keyboard[action].some((code) => this.keyPressed.has(code))
    const keyboardReleased = (action: InputAction): boolean => this.config.keyboard[action].some((code) => this.keyReleased.has(code))
    const padHeld = (action: InputAction): boolean => pads.some((pad) => this.config.gamepad[action].some((index) => Boolean(pad.buttons?.[index]?.pressed || (pad.buttons?.[index]?.value ?? 0) >= 0.5)))
    const padHorizontal = pads.reduce((best, pad) => Math.abs(this.normalizeAxis(pad.axes?.[this.config.axis] ?? 0)) > Math.abs(best) ? this.normalizeAxis(pad.axes?.[this.config.axis] ?? 0) : best, 0)
    const keyboardAxis = Number(keyboardHeld('MOVE_RIGHT')) - Number(keyboardHeld('MOVE_LEFT'))
    const padDigitalAxis = Number(padHeld('MOVE_RIGHT')) - Number(padHeld('MOVE_LEFT'))
    const moveX = Math.abs(keyboardAxis) >= Math.max(Math.abs(padDigitalAxis), Math.abs(padHorizontal)) ? keyboardAxis : Math.abs(padDigitalAxis) >= Math.abs(padHorizontal) ? padDigitalAxis : padHorizontal

    ;([...UI_ACTIONS, ...GAMEPLAY_ACTIONS] as InputAction[]).forEach((action) => {
      const held = keyboardHeld(action) || padHeld(action)
      const previous = this.states.get(action)?.held ?? false
      const pressed = keyboardPressed(action) || (!previous && held)
      const released = keyboardReleased(action) || (previous && !held)
      this.states.set(action, { pressed, held, released })
      if (pressed && isUi(action)) this.pendingUi.add(action)
      if (pressed && !isUi(action)) this.pendingGameplay.add(action)
    })
    this.keyPressed.clear(); this.keyReleased.clear()
    this.lastMoveX = moveX
    // ponytail: 縱深只讀數位方向（鍵盤／D-pad），類比搖桿 Y 軸等實體手把測試後再加。
    this.lastMoveZ = Number(keyboardHeld('MOVE_UP') || padHeld('MOVE_UP')) - Number(keyboardHeld('MOVE_DOWN') || padHeld('MOVE_DOWN'))
  }

  private lastMoveX = 0
  private lastMoveZ = 0
  private normalizeAxis(value: number): number {
    const magnitude = Math.min(1, Math.abs(value)); if (magnitude <= this.config.deadzone) return 0
    return Math.sign(value) * ((magnitude - this.config.deadzone) / (1 - this.config.deadzone))
  }

  /** 只替換戰鬥鍵位；選單與選角 owner 鍵位不受影響。 */
  setCombatBindings(bindings: Bindings): void { Object.assign(this.config.keyboard, combatKeys(bindings)) }
  consumePause(): boolean { return this.pendingGameplay.delete('PAUSE') }
  getActionState(action: InputAction): InputState { return { ...(this.states.get(action) ?? { pressed: false, held: false, released: false }) } }
  consumeOwnedUiActions(): OwnedInput[] { return this.pendingOwned.splice(0) }
  consumeUiActions(): UIAction[] { const actions = [...this.pendingUi]; this.pendingUi.clear(); return actions }
  consumeGameplaySnapshot(): InputSnapshot {
    const pressed = (action: GameplayAction): boolean => this.pendingGameplay.delete(action)
    const jumpPressed = pressed('JUMP'), attack = ATTACK_ACTIONS.filter(pressed)[0]
    return { moveX: this.lastMoveX, moveZ: this.lastMoveZ, jumpPressed, jumpHeld: this.getActionState('JUMP').held, attackPressed: Boolean(attack), attackHeld: ATTACK_ACTIONS.some((action) => this.getActionState(action).held), guardHeld: this.getActionState('GUARD').held, attack, crouchHeld: this.getActionState('CROUCH').held }
  }
}
