import type { OwnedUiAction, PlayerSlotId } from './InputManager'

// 沒有獨立防禦鍵：按住下（CROUCH）或後方向即防禦。
export const COMBAT_ACTIONS = ['MOVE_LEFT', 'MOVE_RIGHT', 'JUMP', 'CROUCH', 'LIGHT_PUNCH', 'HEAVY_PUNCH', 'LIGHT_KICK', 'HEAVY_KICK', 'PAUSE'] as const
export type CombatAction = (typeof COMBAT_ACTIONS)[number]
export type AttackAction = Extract<CombatAction, 'LIGHT_PUNCH' | 'HEAVY_PUNCH' | 'LIGHT_KICK' | 'HEAVY_KICK'>
export const ATTACK_ACTIONS: readonly AttackAction[] = ['LIGHT_PUNCH', 'HEAVY_PUNCH', 'LIGHT_KICK', 'HEAVY_KICK']
export type Bindings = Record<CombatAction, string>
export type ControlProfiles = Record<PlayerSlotId, Bindings>

// 以 KeyboardEvent.code 綁定實體鍵位，不受鍵盤語系影響。
export const DEFAULT_KEYBOARD_BINDINGS: ControlProfiles = {
  P1: { MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', JUMP: 'KeyW', CROUCH: 'KeyS', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', PAUSE: 'Escape' },
  P2: { MOVE_LEFT: 'ArrowLeft', MOVE_RIGHT: 'ArrowRight', JUMP: 'ArrowUp', CROUCH: 'ArrowDown', LIGHT_PUNCH: 'Numpad1', HEAVY_PUNCH: 'Numpad2', LIGHT_KICK: 'Numpad4', HEAVY_KICK: 'Numpad5', PAUSE: 'Escape' },
}
export const CONTROLS_STORAGE_KEY = 'exp2.controls.v3'

const MENU_BACK: Record<PlayerSlotId, string> = { P1: 'KeyK', P2: 'Backspace' }
/** 選單鍵跟著該玩家戰鬥鍵：跳／蹲／左右＝上下左右；確認＝輕拳；返回固定（1P K、2P Backspace），已被佔用時改用重拳鍵。 */
export const menuKeys = (b: Bindings, player: PlayerSlotId = 'P1'): Record<OwnedUiAction, string[]> => {
  const taken = [b.JUMP, b.CROUCH, b.MOVE_LEFT, b.MOVE_RIGHT, b.LIGHT_PUNCH], back = MENU_BACK[player]
  return { NAV_UP: [b.JUMP], NAV_DOWN: [b.CROUCH], NAV_LEFT: [b.MOVE_LEFT], NAV_RIGHT: [b.MOVE_RIGHT], CONFIRM: [b.LIGHT_PUNCH], BACK: [taken.includes(back) ? b.HEAVY_PUNCH : back] }
}
const otherPlayer = (player: PlayerSlotId): PlayerSlotId => player === 'P1' ? 'P2' : 'P1'
/** code 已被另一位玩家使用（其戰鬥鍵或返回鍵）時回傳該玩家；雙方 PAUSE 同鍵不算。 */
export const crossConflict = (profiles: ControlProfiles, player: PlayerSlotId, action: CombatAction, code: string): PlayerSlotId | undefined => {
  const other = otherPlayer(player), theirs = profiles[other]
  if (action === 'PAUSE' && theirs.PAUSE === code) return undefined
  return COMBAT_ACTIONS.some((candidate) => theirs[candidate] === code) || menuKeys(theirs, other).BACK.includes(code) ? other : undefined
}
const crossClean = (profiles: ControlProfiles): boolean => (['P1', 'P2'] as const).every((id) => COMBAT_ACTIONS.every((action) => !crossConflict(profiles, id, action, profiles[id][action])))

export const actionLabel = (action: CombatAction): string => action.replace('_', ' ')
const symbols: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'ESC', Space: 'SPACE',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
}
export const keyLabel = (code: string): string => symbols[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'NUM ').toUpperCase()

/** 組合操作（唯讀）：由目前綁定推導，不能單獨改鍵。 */
export const combinationRows = (bindings: Record<CombatAction, string>, label: (code: string) => string = keyLabel): { label: string; keys: string }[] => {
  const attacks = ATTACK_ACTIONS.map((action) => label(bindings[action])).join(' / ')
  return [
    { label: 'CROUCH ATTACK 蹲攻擊', keys: `${label(bindings.CROUCH)} + ${attacks}` },
    { label: 'AIR ATTACK 空中攻擊', keys: `${label(bindings.JUMP)} + ${attacks}` },
    { label: 'GUARD 防禦', keys: `HOLD ${label(bindings.CROUCH)} / HOLD BACK ${label(bindings.MOVE_LEFT)} / ${label(bindings.MOVE_RIGHT)}` },
  ]
}

// 修飾鍵單獨不可綁；Tab/F1–F12 等會觸發瀏覽器或系統行為（焦點、重新整理、全螢幕、開發者工具）。
export const keyProblem = (code: string): string | undefined => {
  if (!/^[A-Za-z0-9]+$/.test(code)) return 'UNKNOWN KEY'
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code)) return `${keyLabel(code)} IS A MODIFIER KEY`
  if (/^F\d{1,2}$/.test(code) || ['Tab', 'CapsLock', 'NumLock', 'ScrollLock', 'ContextMenu', 'PrintScreen', 'Pause'].includes(code)) return `${keyLabel(code)} IS RESERVED BY THE BROWSER`
  return undefined
}
const validBindings = (value: unknown): value is Bindings => {
  if (!value || typeof value !== 'object') return false
  const codes = COMBAT_ACTIONS.map((action) => (value as Record<string, unknown>)[action])
  return codes.every((code) => typeof code === 'string' && !keyProblem(code)) && new Set(codes).size === codes.length
}

type Store = Pick<Storage, 'getItem' | 'setItem'>
export const browserStore = (): Store | undefined => { try { return globalThis.localStorage } catch { return undefined } }

/** 缺少、損壞、版本不符或無效時，該玩家退回預設；舊存檔缺的動作以預設補齊、已移除的動作（GUARD）丟棄；兩人鍵位互撞時先退 2P、仍撞再退 1P。 */
export const loadProfiles = (store = browserStore()): ControlProfiles => {
  let saved: { version?: unknown; profiles?: Partial<Record<PlayerSlotId, unknown>> } = {}
  try { saved = JSON.parse(store?.getItem(CONTROLS_STORAGE_KEY) ?? '{}') ?? {} } catch { /* 損壞 → 預設 */ }
  const profiles = saved.version === 3 ? saved.profiles ?? {} : {}
  const pick = (id: PlayerSlotId): Bindings => {
    const stored = (profiles[id] && typeof profiles[id] === 'object' ? profiles[id] : {}) as Record<string, unknown>
    const merged = Object.fromEntries(COMBAT_ACTIONS.map((action) => [action, stored[action] ?? DEFAULT_KEYBOARD_BINDINGS[id][action]]))
    return validBindings(merged) ? merged : { ...DEFAULT_KEYBOARD_BINDINGS[id] }
  }
  const loaded = { P1: pick('P1'), P2: pick('P2') }
  if (crossClean(loaded)) return loaded
  const p2Default = { P1: loaded.P1, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2 } }
  return crossClean(p2Default) ? p2Default : { P1: { ...DEFAULT_KEYBOARD_BINDINGS.P1 }, P2: { ...DEFAULT_KEYBOARD_BINDINGS.P2 } }
}
/** 不完整、重複鍵或兩人互撞的 profiles 不寫入。 */
export const saveProfiles = (profiles: ControlProfiles, store = browserStore()): boolean => {
  if (!validBindings(profiles.P1) || !validBindings(profiles.P2) || !crossClean(profiles)) return false
  try { store?.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ version: 3, profiles })); return Boolean(store) } catch { return false }
}

export type EditorState = 'SELECT_BINDING' | 'LISTENING_FOR_KEY' | 'CONFLICT' | 'CONFIRM_RESET'
export const RESET_ROW = COMBAT_ACTIONS.length

type Profiles<C extends string> = Record<PlayerSlotId, Record<CombatAction, C>>
/** 鍵碼規則：鍵盤與手把共用同一個改鍵狀態機，只換驗證、標籤、預設值與跨玩家檢查。 */
export type KeyRules<C extends string> = {
  problem: (code: string) => string | undefined
  label: (code: string) => string
  defaults: Profiles<C>
  cross?: (profiles: Profiles<C>, player: PlayerSlotId, action: CombatAction, code: C) => PlayerSlotId | undefined
}
export const KEYBOARD_RULES: KeyRules<string> = { problem: keyProblem, label: keyLabel, defaults: DEFAULT_KEYBOARD_BINDINGS, cross: crossConflict }

/** 改鍵 UI 的狀態機；只改 profiles，存檔與套用由 onSave 決定。 */
export class ControlsEditor<C extends string = string> {
  state: EditorState = 'SELECT_BINDING'
  focus = 0
  choice = 0 // 對話框：0 = SWAP／RESET（預設），1 = CANCEL
  message = ''
  conflict?: { action: CombatAction; code: C; other: CombatAction }
  constructor(readonly profiles: Profiles<C>, private readonly onSave: (profiles: Profiles<C>) => void, readonly player: PlayerSlotId = 'P1', readonly rules: KeyRules<C> = KEYBOARD_RULES as unknown as KeyRules<C>) {}
  get bindings(): Record<CombatAction, C> { return this.profiles[this.player] }

  move(delta: number): void {
    if (this.state === 'SELECT_BINDING') this.focus = (this.focus + delta + RESET_ROW + 1) % (RESET_ROW + 1)
    else if (this.state !== 'LISTENING_FOR_KEY') this.choice = 1 - this.choice
  }
  activate(): void {
    if (this.state === 'SELECT_BINDING') { this.choice = 0; this.message = ''; this.state = this.focus === RESET_ROW ? 'CONFIRM_RESET' : 'LISTENING_FOR_KEY' }
    else if (this.state === 'CONFLICT') this.resolveConflict(this.choice === 0)
    else if (this.state === 'CONFIRM_RESET') { if (this.choice === 0) this.reset(); else this.state = 'SELECT_BINDING' }
  }
  /** LISTENING 時：Escape 取消；其他鍵驗證後套用、衝突或拒絕。 */
  capture(input: string): void {
    if (this.state !== 'LISTENING_FOR_KEY') return
    if (input === 'Escape') { this.state = 'SELECT_BINDING'; this.message = 'CANCELLED'; return }
    const problem = this.rules.problem(input)
    if (problem) { this.message = problem; return }
    const code = input as C, action = COMBAT_ACTIONS[this.focus], owner = this.rules.cross?.(this.profiles, this.player, action, code)
    if (owner) { this.message = this.usedBy(code, owner); return }
    const other = COMBAT_ACTIONS.find((candidate) => candidate !== action && this.bindings[candidate] === code)
    if (other) { this.conflict = { action, code, other }; this.choice = 0; this.state = 'CONFLICT'; this.message = `${this.rules.label(code)} IS ALREADY ASSIGNED TO ${actionLabel(other)}`; return }
    this.bindings[action] = code; this.save('SAVED')
  }
  /** BACK：取消子狀態；已在列表時回傳 true 代表關閉面板。 */
  back(): boolean {
    if (this.state === 'SELECT_BINDING') return true
    if (this.state === 'LISTENING_FOR_KEY') this.capture('Escape')
    else this.cancelDialog()
    return false
  }
  private usedBy(code: string, owner: PlayerSlotId): string { return `${this.rules.label(code)} IS USED BY PLAYER ${owner.slice(1)}` }
  private resolveConflict(swap: boolean): void {
    const conflict = this.conflict
    if (!conflict || !swap) { this.cancelDialog(); return }
    this.bindings[conflict.other] = this.bindings[conflict.action]
    this.bindings[conflict.action] = conflict.code
    this.save('SWAPPED')
  }
  /** 重設會撞到另一位玩家的鍵時拒絕，綁定不變。 */
  private reset(): void {
    const defaults = this.rules.defaults[this.player], next = { ...this.profiles, [this.player]: defaults }
    const action = COMBAT_ACTIONS.find((candidate) => this.rules.cross?.(next, this.player, candidate, defaults[candidate]))
    if (action) { this.state = 'SELECT_BINDING'; this.message = this.usedBy(defaults[action], otherPlayer(this.player)); return }
    Object.assign(this.bindings, defaults); this.save('RESET TO DEFAULT')
  }
  private cancelDialog(): void { this.conflict = undefined; this.state = 'SELECT_BINDING'; this.message = 'CANCELLED' }
  private save(message: string): void { this.conflict = undefined; this.state = 'SELECT_BINDING'; this.message = message; this.onSave(this.profiles) }
}
