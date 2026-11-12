import { ATTACK_ACTIONS, COMBAT_ACTIONS, DEFAULT_KEYBOARD_BINDINGS, menuKeys, type AttackAction, type Bindings, type CombatAction, type ControlProfiles } from './ControlProfile'
import { ANALOG_DIRECTIONS, DEFAULT_PAD_BINDINGS, PAD_SYSTEM, rememberPads, samplePads, updateSlots, type PadCode, type PadDown, type PadProfiles, type PadSlots } from './GamepadProfile'

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
/** device 只在手把來源時出現；鍵盤擁有者動作維持原本的形狀。 */
export type OwnedInput = { owner: PlayerSlotId; action: OwnedUiAction; device?: 'gamepad' }
type OwnerKeys = Partial<Record<OwnedUiAction, readonly string[]>>

export type InputConfig = {
  keyboard?: Partial<Record<InputAction, readonly string[]>>
  owners?: Partial<Record<PlayerSlotId, OwnerKeys>>
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
// 手把選單鍵：方向與確認（輕踢，預設 ✕）由該玩家的戰鬥鍵推導；返回是固定的 R1（PAD_SYSTEM），重踢在選單沒有作用。
const PAD_MENU: Partial<Record<CombatAction, OwnedUiAction>> = { JUMP: 'NAV_UP', CROUCH: 'NAV_DOWN', MOVE_LEFT: 'NAV_LEFT', MOVE_RIGHT: 'NAV_RIGHT', LIGHT_KICK: 'CONFIRM' }
const PLAYERS: readonly PlayerSlotId[] = ['P1', 'P2']
/** pad：該玩家擁有的手把目前按住的戰鬥動作（含類比方向）；padPresses：本幀新按下的鍵碼。 */
type GameplayState = { keys: Record<CombatAction, readonly string[]>; states: Map<GameplayAction, InputState>; pending: Set<GameplayAction>; moveX: number; pad: ReadonlySet<CombatAction>; padPresses: ReadonlySet<PadCode> }
const idle = (): InputState => ({ pressed: false, held: false, released: false })
const NO_CODES: ReadonlySet<PadCode> = new Set()

const isUi = (action: InputAction): action is UIAction => (UI_ACTIONS as readonly string[]).includes(action)

export class InputManager {
  private readonly config: Required<Pick<InputConfig, 'deadzone'>> & { keyboard: Record<InputAction, readonly string[]> }
  private readonly keys = new Set<string>()
  private readonly keyPressed = new Set<string>()
  private readonly keyReleased = new Set<string>()
  private readonly states = new Map<UIAction, InputState>(UI_ACTIONS.map((action) => [action, idle()]))
  private readonly pendingUi = new Set<UIAction>()
  private readonly gameplay: Record<PlayerSlotId, GameplayState>
  private pendingOwned: OwnedInput[] = []
  private ownerKeys: Record<PlayerSlotId, OwnerKeys>
  private keyboardTarget?: KeyboardTarget
  private device: 'keyboard' | 'gamepad' = 'keyboard'
  private padDown: PadDown = new Map()
  private slots: PadSlots = { P1: undefined, P2: undefined }
  private padBindings: PadProfiles = { P1: DEFAULT_PAD_BINDINGS, P2: DEFAULT_PAD_BINDINGS }
  /** 最後一次映射到戰鬥動作的實體鍵（DEV 診斷用）。 */
  lastCombatInput?: { code: string; action: CombatAction }
  lastDevice(): 'keyboard' | 'gamepad' { return this.device }
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event.code)
  private readonly onKeyUp = (event: KeyboardEvent): void => this.handleKeyUp(event.code)
  private readonly onBlur = (): void => {
    this.keys.forEach((code) => this.keyReleased.add(code))
    this.keys.clear(); this.keyPressed.clear(); this.pendingUi.clear(); PLAYERS.forEach((id) => this.gameplay[id].pending.clear()); this.pendingOwned = []
  }

  constructor(config: InputConfig = {}) {
    this.config = {
      deadzone: config.deadzone ?? 0.25,
      keyboard: Object.fromEntries((Object.keys(defaults) as InputAction[]).map((action) => [action, config.keyboard?.[action] ?? defaults[action]])) as Record<InputAction, readonly string[]>,
    }
    const gameplay = (keys: Record<CombatAction, readonly string[]>): GameplayState => ({ keys, states: new Map(GAMEPLAY_ACTIONS.map((action) => [action, idle()])), pending: new Set(), moveX: 0, pad: new Set(), padPresses: NO_CODES })
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

  /**
   * gamepads 必須保留 navigator.getGamepads() 的 null，位置即 Gamepad.index。
   * 回傳本幀手把斷線的玩家（其手把輸入已放開、未消費的邊緣已丟棄）。
   */
  update(gamepads: readonly (GamepadLike | null | undefined)[] = []): PlayerSlotId[] {
    const previous = this.padDown, down = samplePads(gamepads, previous), slots = updateSlots(this.slots, down, previous), before = this.slots
    if ([...down].some(([index, codes]) => [...codes].some((code) => !previous.get(index)?.has(code)))) this.device = 'gamepad'
    const lost = PLAYERS.filter((id) => this.slots[id] !== undefined && slots[id] === undefined)
    lost.forEach((id) => { this.gameplay[id].pending.clear(); this.pendingOwned = this.pendingOwned.filter(({ owner }) => owner !== id) })
    this.padDown = rememberPads(previous, down); this.slots = slots
    const sample = <A extends InputAction>(actions: readonly A[], keys: (action: A) => readonly string[], padHeld: (action: A) => boolean, padWas: (action: A) => boolean, states: Map<A, InputState>, pending: Set<A>): void => actions.forEach((action) => {
      const codes = keys(action), held = codes.some((code) => this.keys.has(code)) || padHeld(action), previousHeld = (states.get(action)?.held ?? false) || padWas(action)
      const pressed = codes.some((code) => this.keyPressed.has(code)) || (!previousHeld && held)
      const released = codes.some((code) => this.keyReleased.has(code)) || (previousHeld && !held)
      states.set(action, { pressed, held, released }); if (pressed) pending.add(action)
    })
    sample(UI_ACTIONS, (action) => this.config.keyboard[action], () => false, () => false, this.states, this.pendingUi)
    PLAYERS.forEach((id) => {
      const player = this.gameplay[id], index = slots[id], codes = index === undefined ? NO_CODES : down.get(index) ?? NO_CODES, bindings = this.padBindings[id]
      const actionsOf = (held: ReadonlySet<PadCode>): Set<CombatAction> => new Set(COMBAT_ACTIONS.filter((action) => held.has(bindings[action]) || ANALOG_DIRECTIONS[action]?.some((code) => held.has(code))))
      const pad = actionsOf(codes)
      // 剛取得所有權：取得前就按著的鍵（等位子或跨斷線）視為早已按住，只有本幀新按下的鍵產生邊緣。
      const was = index !== undefined && before[id] !== index ? actionsOf(new Set([...codes].filter((code) => previous.get(index)?.has(code)))) : player.pad
      pad.forEach((action) => { const menu = PAD_MENU[action]; if (menu && !was.has(action)) this.pendingOwned.push({ owner: id, action: menu, device: 'gamepad' }) })
      player.pad = pad
      player.padPresses = index === undefined ? NO_CODES : new Set([...codes].filter((code) => !previous.get(index)?.has(code)))
      if (player.padPresses.has(PAD_SYSTEM.BACK)) this.pendingOwned.push({ owner: id, action: 'BACK', device: 'gamepad' })
      sample(GAMEPLAY_ACTIONS, (action) => player.keys[action], (action) => pad.has(action), (action) => was.has(action), player.states, player.pending)
      const keyboardHeld = (action: GameplayAction): boolean => player.keys[action].some((code) => this.keys.has(code))
      const keyboardAxis = Number(keyboardHeld('MOVE_RIGHT')) - Number(keyboardHeld('MOVE_LEFT'))
      // 數位方向只看綁定鍵（±1）；類比方向另走 deadzone 正規化，否則推過 0.5 就跳成 ±1。
      const padDigitalAxis = Number(codes.has(bindings.MOVE_RIGHT)) - Number(codes.has(bindings.MOVE_LEFT))
      const axes = index === undefined ? undefined : gamepads[index]?.axes
      const padHorizontal = [0, 2].map((axis) => this.normalizeAxis(axes?.[axis] ?? 0)).reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0)
      player.moveX = Math.abs(keyboardAxis) >= Math.max(Math.abs(padDigitalAxis), Math.abs(padHorizontal)) ? keyboardAxis : Math.abs(padDigitalAxis) >= Math.abs(padHorizontal) ? padDigitalAxis : padHorizontal
    })
    this.keyPressed.clear(); this.keyReleased.clear()
    return lost
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
  setPadBindings(profiles: PadProfiles): void { this.padBindings = profiles }
  /** 該玩家擁有的手把（Gamepad.index），沒有則 undefined。 */
  padOwner(player: PlayerSlotId): number | undefined { return this.slots[player] }
  /** 本幀該玩家手把新按下的鍵碼（改鍵擷取用）；只看該玩家自己的手把。 */
  padPress(player: PlayerSlotId): PadCode | undefined { return [...this.gameplay[player].padPresses][0] }
  /** 本幀該玩家手把新按下 L3（P0 開啟 CONTROLS）；不是選單動作，所以不進擁有者佇列。 */
  controlsPress(player: PlayerSlotId): boolean { return this.gameplay[player].padPresses.has(PAD_SYSTEM.CONTROLS) }
  /** 任一玩家的 PAUSE 都算；兩邊都清掉，共用鍵（Escape）不會留到下一次。 */
  consumePause(): boolean { const p1 = this.gameplay.P1.pending.delete('PAUSE'), p2 = this.gameplay.P2.pending.delete('PAUSE'); return p1 || p2 }
  getActionState(action: InputAction, player: PlayerSlotId = 'P1'): InputState { return { ...((isUi(action) ? this.states.get(action) : this.gameplay[player].states.get(action)) ?? idle()) } }
  consumeOwnedUiActions(): OwnedInput[] { return this.pendingOwned.splice(0) }
  consumeUiActions(): UIAction[] { const actions = [...this.pendingUi]; this.pendingUi.clear(); return actions }
  consumeGameplaySnapshot(player: PlayerSlotId = 'P1'): InputSnapshot {
    const { pending, moveX } = this.gameplay[player], pressed = (action: GameplayAction): boolean => pending.delete(action)
    const jumpPressed = pressed('JUMP'), attack = ATTACK_ACTIONS.filter(pressed)[0], crouchHeld = this.getActionState('CROUCH', player).held
    // 按住下＝防禦；出招仍優先（CombatWorld 先處理攻擊緩衝再看 guard）。
    return { moveX, jumpPressed, attackPressed: Boolean(attack), attack, crouchHeld, guardHeld: crouchHeld }
  }
}
