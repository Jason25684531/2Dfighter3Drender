import { ATTACK_ACTIONS, COMBAT_ACTIONS, DEFAULT_KEYBOARD_BINDINGS, menuKeys, type AttackAction, type Bindings, type CombatAction, type ControlProfiles } from './ControlProfile'

export const UI_ACTIONS = ['NAV_UP', 'NAV_DOWN', 'NAV_LEFT', 'NAV_RIGHT', 'CONFIRM', 'BACK', 'OPEN_MENU'] as const
export const GAMEPLAY_ACTIONS = COMBAT_ACTIONS
export type UIAction = (typeof UI_ACTIONS)[number]
export type GameplayAction = CombatAction
export type InputAction = UIAction | GameplayAction

export type InputSnapshot = {
  moveX: number
  jumpPressed: boolean
  attackPressed: boolean
  attack?: AttackAction
  // 蹲只供呈現解析，Combat 沒有蹲。
  crouchHeld: boolean
  guardHeld: boolean
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
// P1 選角的雙玩家鍵位（各自跟著自己的戰鬥鍵，見 menuKeys）；與上方未標記鍵位並存。
const DEFAULT_OWNER_KEYS: Record<PlayerSlotId, OwnerKeys> = { P1: menuKeys(DEFAULT_KEYBOARD_BINDINGS.P1, 'P1'), P2: menuKeys(DEFAULT_KEYBOARD_BINDINGS.P2, 'P2') }
const PLAYERS: readonly PlayerSlotId[] = ['P1', 'P2']
type GameplayState = { keys: Record<CombatAction, readonly string[]>; states: Map<GameplayAction, InputState>; pending: Set<GameplayAction>; moveX: number }
const idle = (): InputState => ({ pressed: false, held: false, released: false })
const defaultGamepad: Record<InputAction, readonly number[]> = {
  NAV_UP: [12], NAV_DOWN: [13], NAV_LEFT: [14], NAV_RIGHT: [15], CONFIRM: [0], BACK: [1], OPEN_MENU: [9],
  MOVE_LEFT: [14], MOVE_RIGHT: [15], JUMP: [12], CROUCH: [13], LIGHT_PUNCH: [2], HEAVY_PUNCH: [3], LIGHT_KICK: [0], HEAVY_KICK: [1], GUARD: [5], PAUSE: [9],
}

const isUi = (action: InputAction): action is UIAction => (UI_ACTIONS as readonly string[]).includes(action)

export class InputManager {
  private readonly config: Required<Pick<InputConfig, 'axis' | 'deadzone'>> & { keyboard: Record<InputAction, readonly string[]>; gamepad: Record<InputAction, readonly number[]> }
  private readonly keys = new Set<string>()
  private readonly keyPressed = new Set<string>()
  private readonly keyReleased = new Set<string>()
  private readonly states = new Map<UIAction, InputState>(UI_ACTIONS.map((action) => [action, idle()]))
  private readonly pendingUi = new Set<UIAction>()
  private readonly gameplay: Record<PlayerSlotId, GameplayState>
  /** 雙人戰鬥：第 1 支手把給 1P、第 2 支給 2P；否則全部給 1P。 */
  private versus = false
  private readonly pendingOwned: OwnedInput[] = []
  private ownerKeys: Record<PlayerSlotId, OwnerKeys>
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
    this.keys.clear(); this.keyPressed.clear(); this.pendingUi.clear(); PLAYERS.forEach((id) => this.gameplay[id].pending.clear()); this.pendingOwned.length = 0
  }

  constructor(config: InputConfig = {}) {
    this.config = {
      axis: config.axis ?? 0,
      deadzone: config.deadzone ?? 0.25,
      keyboard: Object.fromEntries((Object.keys(defaults) as InputAction[]).map((action) => [action, config.keyboard?.[action] ?? defaults[action]])) as Record<InputAction, readonly string[]>,
      gamepad: Object.fromEntries((Object.keys(defaultGamepad) as InputAction[]).map((action) => [action, config.gamepad?.[action] ?? defaultGamepad[action]])) as Record<InputAction, readonly number[]>,
    }
    const gameplay = (keys: Record<CombatAction, readonly string[]>): GameplayState => ({ keys, states: new Map(GAMEPLAY_ACTIONS.map((action) => [action, idle()])), pending: new Set(), moveX: 0 })
    this.gameplay = { P1: gameplay(this.config.keyboard), P2: gameplay(combatKeys(DEFAULT_KEYBOARD_BINDINGS.P2)) }
    this.baseUiKeys = Object.fromEntries(UI_ACTIONS.map((action) => [action, this.config.keyboard[action]])) as Record<UIAction, readonly string[]>
    this.baseP2Keys = { ...DEFAULT_OWNER_KEYS.P2, ...config.owners?.P2 }
    this.ownerKeys = { P1: { ...DEFAULT_OWNER_KEYS.P1, ...config.owners?.P1 }, P2: this.baseP2Keys }
    this.applyP1Priority()
  }
  private readonly baseUiKeys: Record<UIAction, readonly string[]>
  private baseP2Keys: OwnerKeys
  /** 1P 選單鍵優先：同一實體鍵只屬於 1P，不再觸發未標記選單鍵或 2P 鍵（否則改成方向鍵後 ← 派送兩次＝原地不動、Enter 讓 2P 加入）。 */
  private applyP1Priority(): void {
    const taken = new Set(Object.values(this.ownerKeys.P1).flat()), free = (codes: readonly string[] = []): string[] => codes.filter((code) => !taken.has(code))
    UI_ACTIONS.forEach((action) => { this.config.keyboard[action] = free(this.baseUiKeys[action]) })
    this.ownerKeys.P2 = Object.fromEntries(Object.entries(this.baseP2Keys).map(([action, codes]) => [action, free(codes)]))
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
      const action = COMBAT_ACTIONS.find((candidate) => this.gameplay.P1.keys[candidate].includes(code))
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
    const padHeld = (action: InputAction, padList: readonly GamepadLike[]): boolean => padList.some((pad) => this.config.gamepad[action].some((index) => Boolean(pad.buttons?.[index]?.pressed || (pad.buttons?.[index]?.value ?? 0) >= 0.5)))
    const sample = <A extends InputAction>(actions: readonly A[], keys: (action: A) => readonly string[], padList: readonly GamepadLike[], states: Map<A, InputState>, pending: Set<A>): void => actions.forEach((action) => {
      const codes = keys(action), held = codes.some((code) => this.keys.has(code)) || padHeld(action, padList), previous = states.get(action)?.held ?? false
      const pressed = codes.some((code) => this.keyPressed.has(code)) || (!previous && held)
      const released = codes.some((code) => this.keyReleased.has(code)) || (previous && !held)
      states.set(action, { pressed, held, released }); if (pressed) pending.add(action)
    })
    sample(UI_ACTIONS, (action) => this.config.keyboard[action], pads, this.states, this.pendingUi)
    PLAYERS.forEach((id, index) => {
      const player = this.gameplay[id], padList = this.versus ? pads.slice(index, index + 1) : id === 'P1' ? pads : []
      sample(GAMEPLAY_ACTIONS, (action) => player.keys[action], padList, player.states, player.pending)
      const keyboardHeld = (action: GameplayAction): boolean => player.keys[action].some((code) => this.keys.has(code))
      const keyboardAxis = Number(keyboardHeld('MOVE_RIGHT')) - Number(keyboardHeld('MOVE_LEFT'))
      const padDigitalAxis = Number(padHeld('MOVE_RIGHT', padList)) - Number(padHeld('MOVE_LEFT', padList))
      const padHorizontal = padList.reduce((best, pad) => Math.abs(this.normalizeAxis(pad.axes?.[this.config.axis] ?? 0)) > Math.abs(best) ? this.normalizeAxis(pad.axes?.[this.config.axis] ?? 0) : best, 0)
      player.moveX = Math.abs(keyboardAxis) >= Math.max(Math.abs(padDigitalAxis), Math.abs(padHorizontal)) ? keyboardAxis : Math.abs(padDigitalAxis) >= Math.abs(padHorizontal) ? padDigitalAxis : padHorizontal
    })
    this.keyPressed.clear(); this.keyReleased.clear()
  }

  private normalizeAxis(value: number): number {
    const magnitude = Math.min(1, Math.abs(value)); if (magnitude <= this.config.deadzone) return 0
    return Math.sign(value) * ((magnitude - this.config.deadzone) / (1 - this.config.deadzone))
  }

  /** 套用兩位玩家的自訂鍵位：戰鬥鍵與各自的選單鍵（menuKeys）；2P 與未標記選單鍵讓出 1P 用到的鍵。 */
  setCombatBindings(profiles: ControlProfiles): void {
    PLAYERS.forEach((id) => { this.gameplay[id].keys = combatKeys(profiles[id]) })
    this.baseP2Keys = menuKeys(profiles.P2, 'P2'); this.ownerKeys = { P1: menuKeys(profiles.P1, 'P1'), P2: this.baseP2Keys }; this.applyP1Priority()
  }
  setVersus(versus: boolean): void { this.versus = versus }
  /** 任一玩家的 PAUSE 都算；兩邊都清掉，共用鍵（Escape）不會留到下一次。 */
  consumePause(): boolean { const p1 = this.gameplay.P1.pending.delete('PAUSE'), p2 = this.gameplay.P2.pending.delete('PAUSE'); return p1 || p2 }
  getActionState(action: InputAction, player: PlayerSlotId = 'P1'): InputState { return { ...((isUi(action) ? this.states.get(action) : this.gameplay[player].states.get(action)) ?? idle()) } }
  consumeOwnedUiActions(): OwnedInput[] { return this.pendingOwned.splice(0) }
  consumeUiActions(): UIAction[] { const actions = [...this.pendingUi]; this.pendingUi.clear(); return actions }
  consumeGameplaySnapshot(player: PlayerSlotId = 'P1'): InputSnapshot {
    const { pending, moveX } = this.gameplay[player], pressed = (action: GameplayAction): boolean => pending.delete(action)
    const jumpPressed = pressed('JUMP'), attack = ATTACK_ACTIONS.filter(pressed)[0]
    return { moveX, jumpPressed, attackPressed: Boolean(attack), attack, crouchHeld: this.getActionState('CROUCH', player).held, guardHeld: this.getActionState('GUARD', player).held }
  }
}
