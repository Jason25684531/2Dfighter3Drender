export const UI_ACTIONS = ['NAV_UP', 'NAV_DOWN', 'NAV_LEFT', 'NAV_RIGHT', 'CONFIRM', 'BACK', 'OPEN_MENU'] as const
export const GAMEPLAY_ACTIONS = ['MOVE_LEFT', 'MOVE_RIGHT', 'JUMP', 'ATTACK', 'GUARD'] as const
export type UIAction = (typeof UI_ACTIONS)[number]
export type GameplayAction = (typeof GAMEPLAY_ACTIONS)[number]
export type InputAction = UIAction | GameplayAction

export type InputSnapshot = {
  moveX: number
  jumpPressed: boolean
  jumpHeld: boolean
  attackPressed: boolean
  attackHeld: boolean
  guardHeld: boolean
}

export type InputState = { pressed: boolean; held: boolean; released: boolean }
export type GamepadButtonLike = { pressed?: boolean; value?: number }
export type GamepadLike = { buttons?: readonly GamepadButtonLike[]; axes?: readonly number[]; connected?: boolean }
export type KeyboardTarget = { addEventListener: (type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void) => void; removeEventListener: (type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void) => void }

export type InputConfig = {
  keyboard?: Partial<Record<InputAction, readonly string[]>>
  gamepad?: Partial<Record<InputAction, readonly number[]>>
  axis?: number
  deadzone?: number
}

const defaults: Record<InputAction, readonly string[]> = {
  NAV_UP: ['ArrowUp'], NAV_DOWN: ['ArrowDown'], NAV_LEFT: ['ArrowLeft'], NAV_RIGHT: ['ArrowRight'],
  CONFIRM: ['Enter'], BACK: ['Escape'], OPEN_MENU: ['KeyM'],
  MOVE_LEFT: ['KeyA', 'ArrowLeft'], MOVE_RIGHT: ['KeyD', 'ArrowRight'], JUMP: ['Space'], ATTACK: ['KeyJ'], GUARD: ['KeyK'],
}
const defaultGamepad: Record<InputAction, readonly number[]> = {
  NAV_UP: [12], NAV_DOWN: [13], NAV_LEFT: [14], NAV_RIGHT: [15], CONFIRM: [0], BACK: [1], OPEN_MENU: [9],
  MOVE_LEFT: [14], MOVE_RIGHT: [15], JUMP: [0], ATTACK: [2], GUARD: [4],
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
  private keyboardTarget?: KeyboardTarget
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event.code)
  private readonly onKeyUp = (event: KeyboardEvent): void => this.handleKeyUp(event.code)

  constructor(config: InputConfig = {}) {
    this.config = {
      axis: config.axis ?? 0,
      deadzone: config.deadzone ?? 0.25,
      keyboard: Object.fromEntries((Object.keys(defaults) as InputAction[]).map((action) => [action, config.keyboard?.[action] ?? defaults[action]])) as Record<InputAction, readonly string[]>,
      gamepad: Object.fromEntries((Object.keys(defaultGamepad) as InputAction[]).map((action) => [action, config.gamepad?.[action] ?? defaultGamepad[action]])) as Record<InputAction, readonly number[]>,
    }
  }

  attachKeyboard(target: KeyboardTarget): void {
    this.detachKeyboard(); this.keyboardTarget = target
    target.addEventListener('keydown', this.onKeyDown); target.addEventListener('keyup', this.onKeyUp)
  }

  detachKeyboard(): void {
    if (!this.keyboardTarget) return
    this.keyboardTarget.removeEventListener('keydown', this.onKeyDown); this.keyboardTarget.removeEventListener('keyup', this.onKeyUp); this.keyboardTarget = undefined
  }

  handleKeyDown(code: string): void { if (!this.keys.has(code)) this.keyPressed.add(code); this.keys.add(code) }
  handleKeyUp(code: string): void { if (this.keys.delete(code)) this.keyReleased.add(code) }

  update(gamepads: readonly GamepadLike[] = []): void {
    const pads = gamepads.filter((pad) => pad.connected !== false)
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
  }

  private lastMoveX = 0
  private normalizeAxis(value: number): number {
    const magnitude = Math.min(1, Math.abs(value)); if (magnitude <= this.config.deadzone) return 0
    return Math.sign(value) * ((magnitude - this.config.deadzone) / (1 - this.config.deadzone))
  }

  getActionState(action: InputAction): InputState { return { ...(this.states.get(action) ?? { pressed: false, held: false, released: false }) } }
  consumeUiActions(): UIAction[] { const actions = [...this.pendingUi]; this.pendingUi.clear(); return actions }
  consumeGameplaySnapshot(): InputSnapshot {
    const pressed = (action: GameplayAction): boolean => this.pendingGameplay.delete(action)
    return { moveX: this.lastMoveX, jumpPressed: pressed('JUMP'), jumpHeld: this.getActionState('JUMP').held, attackPressed: pressed('ATTACK'), attackHeld: this.getActionState('ATTACK').held, guardHeld: this.getActionState('GUARD').held }
  }
}
