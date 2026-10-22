import type { PlayerSlotId } from './InputManager'

// 可改鍵的戰鬥語意動作；GUARD 是獨立按鍵（按住即防禦），往後只是移動。
export const COMBAT_ACTIONS = ['MOVE_LEFT', 'MOVE_RIGHT', 'MOVE_UP', 'MOVE_DOWN', 'JUMP', 'CROUCH', 'LIGHT_PUNCH', 'HEAVY_PUNCH', 'LIGHT_KICK', 'HEAVY_KICK', 'GUARD', 'PAUSE'] as const
export type CombatAction = (typeof COMBAT_ACTIONS)[number]
export type AttackAction = Extract<CombatAction, 'LIGHT_PUNCH' | 'HEAVY_PUNCH' | 'LIGHT_KICK' | 'HEAVY_KICK'>
export const ATTACK_ACTIONS: readonly AttackAction[] = ['LIGHT_PUNCH', 'HEAVY_PUNCH', 'LIGHT_KICK', 'HEAVY_KICK']
export type Bindings = Record<CombatAction, string>
export type ControlProfiles = Record<PlayerSlotId, Bindings>

// 以 KeyboardEvent.code 綁定實體鍵位，不受鍵盤語系影響。
// P2 profile 只是資料：2P 目前是 CPU，沒有任何地方讀它控制角色。
export const DEFAULT_KEYBOARD_BINDINGS: ControlProfiles = {
  // 2.5D：W/S 是縱深上下，跳躍改到 Space、蹲改到 X。
  P1: { MOVE_LEFT: 'KeyA', MOVE_RIGHT: 'KeyD', MOVE_UP: 'KeyW', MOVE_DOWN: 'KeyS', JUMP: 'Space', CROUCH: 'KeyX', LIGHT_PUNCH: 'KeyF', HEAVY_PUNCH: 'KeyU', LIGHT_KICK: 'KeyG', HEAVY_KICK: 'KeyI', GUARD: 'KeyK', PAUSE: 'Escape' },
  P2: { MOVE_LEFT: 'ArrowLeft', MOVE_RIGHT: 'ArrowRight', MOVE_UP: 'ArrowUp', MOVE_DOWN: 'ArrowDown', JUMP: 'Numpad0', CROUCH: 'NumpadDecimal', LIGHT_PUNCH: 'Numpad1', HEAVY_PUNCH: 'Numpad2', LIGHT_KICK: 'Numpad4', HEAVY_KICK: 'Numpad5', GUARD: 'Numpad6', PAUSE: 'Escape' },
}
export const CONTROLS_STORAGE_KEY = 'exp2.controls.v1'

export const actionLabel = (action: CombatAction): string => action.replace('_', ' ')
const symbols: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'ESC', Space: 'SPACE',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
}
export const keyLabel = (code: string): string => symbols[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'NUM ').toUpperCase()

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
const browserStore = (): Store | undefined => { try { return globalThis.localStorage } catch { return undefined } }

/** 缺少、損壞、版本不符或不完整時，該玩家退回預設。 */
export const loadProfiles = (store = browserStore()): ControlProfiles => {
  let saved: { version?: unknown; profiles?: Partial<Record<PlayerSlotId, unknown>> } = {}
  try { saved = JSON.parse(store?.getItem(CONTROLS_STORAGE_KEY) ?? '{}') ?? {} } catch { /* 損壞 → 預設 */ }
  const profiles = saved.version === 1 ? saved.profiles ?? {} : {}
  return { P1: validBindings(profiles.P1) ? { ...profiles.P1 } : { ...DEFAULT_KEYBOARD_BINDINGS.P1 }, P2: validBindings(profiles.P2) ? { ...profiles.P2 } : { ...DEFAULT_KEYBOARD_BINDINGS.P2 } }
}
/** 不完整或重複鍵的 profile 不寫入。 */
export const saveProfiles = (profiles: ControlProfiles, store = browserStore()): boolean => {
  if (!validBindings(profiles.P1) || !validBindings(profiles.P2)) return false
  try { store?.setItem(CONTROLS_STORAGE_KEY, JSON.stringify({ version: 1, profiles })); return Boolean(store) } catch { return false }
}

export type EditorState = 'SELECT_BINDING' | 'LISTENING_FOR_KEY' | 'CONFLICT' | 'CONFIRM_RESET'
export const RESET_ROW = COMBAT_ACTIONS.length

/** 改鍵 UI 的狀態機；只改 profiles，存檔與套用由 onSave 決定。 */
export class ControlsEditor {
  state: EditorState = 'SELECT_BINDING'
  focus = 0
  choice = 0 // 對話框：0 = SWAP／RESET（預設），1 = CANCEL
  message = ''
  conflict?: { action: CombatAction; code: string; other: CombatAction }
  constructor(readonly profiles: ControlProfiles, private readonly onSave: (profiles: ControlProfiles) => void, readonly player: PlayerSlotId = 'P1') {}
  get bindings(): Bindings { return this.profiles[this.player] }

  move(delta: number): void {
    if (this.state === 'SELECT_BINDING') this.focus = (this.focus + delta + RESET_ROW + 1) % (RESET_ROW + 1)
    else if (this.state !== 'LISTENING_FOR_KEY') this.choice = 1 - this.choice
  }
  activate(): void {
    if (this.state === 'SELECT_BINDING') { this.choice = 0; this.message = ''; this.state = this.focus === RESET_ROW ? 'CONFIRM_RESET' : 'LISTENING_FOR_KEY' }
    else if (this.state === 'CONFLICT') this.resolveConflict(this.choice === 0)
    else if (this.state === 'CONFIRM_RESET') { if (this.choice === 0) { Object.assign(this.bindings, DEFAULT_KEYBOARD_BINDINGS[this.player]); this.save('RESET TO DEFAULT') } else this.state = 'SELECT_BINDING' }
  }
  /** LISTENING 時：Escape 取消；其他鍵驗證後套用、衝突或拒絕。 */
  capture(code: string): void {
    if (this.state !== 'LISTENING_FOR_KEY') return
    if (code === 'Escape') { this.state = 'SELECT_BINDING'; this.message = 'CANCELLED'; return }
    const problem = keyProblem(code)
    if (problem) { this.message = problem; return }
    const action = COMBAT_ACTIONS[this.focus]
    const other = COMBAT_ACTIONS.find((candidate) => candidate !== action && this.bindings[candidate] === code)
    if (other) { this.conflict = { action, code, other }; this.choice = 0; this.state = 'CONFLICT'; this.message = `${keyLabel(code)} IS ALREADY ASSIGNED TO ${actionLabel(other)}`; return }
    this.bindings[action] = code; this.save('SAVED')
  }
  /** BACK：取消子狀態；已在列表時回傳 true 代表關閉面板。 */
  back(): boolean {
    if (this.state === 'SELECT_BINDING') return true
    if (this.state === 'LISTENING_FOR_KEY') this.capture('Escape')
    else this.cancelDialog()
    return false
  }
  private resolveConflict(swap: boolean): void {
    const conflict = this.conflict
    if (!conflict || !swap) { this.cancelDialog(); return }
    this.bindings[conflict.other] = this.bindings[conflict.action]
    this.bindings[conflict.action] = conflict.code
    this.save('SWAPPED')
  }
  private cancelDialog(): void { this.conflict = undefined; this.state = 'SELECT_BINDING'; this.message = 'CANCELLED' }
  private save(message: string): void { this.conflict = undefined; this.state = 'SELECT_BINDING'; this.message = message; this.onSave(this.profiles) }
}
