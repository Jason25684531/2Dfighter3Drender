import { browserStore, COMBAT_ACTIONS, type CombatAction, type KeyRules } from './ControlProfile'
import type { GamepadLike, PlayerSlotId } from './InputManager'

/** 按鈕 n，或軸 n 的正／負方向。 */
export type PadCode = `B${number}` | `A${number}+` | `A${number}-`
export type PadBindings = Record<CombatAction, PadCode>
export type PadProfiles = Record<PlayerSlotId, PadBindings>
/** 玩家擁有的手把，值是 Gamepad.index。 */
export type PadSlots = Record<PlayerSlotId, number | undefined>
/** 每支連線中的手把（鍵為 Gamepad.index）目前按住的鍵碼。 */
export type PadDown = ReadonlyMap<number, ReadonlySet<PadCode>>

export const PAD_STORAGE_KEY = 'exp2.gamepad.v1'
export const DEFAULT_PAD_BINDINGS: PadBindings = { MOVE_LEFT: 'B14', MOVE_RIGHT: 'B15', JUMP: 'B12', CROUCH: 'B13', LIGHT_PUNCH: 'B2', HEAVY_PUNCH: 'B3', LIGHT_KICK: 'B0', HEAVY_KICK: 'B1', PAUSE: 'B9' }
// 類比固定併入方向、不佔改鍵欄位：搖桿切到 LS（軸 0／1）或 RS（軸 2／3）模式都能直接用。
export const ANALOG_DIRECTIONS: Partial<Record<CombatAction, readonly PadCode[]>> = { MOVE_LEFT: ['A0-', 'A2-'], MOVE_RIGHT: ['A0+', 'A2+'], JUMP: ['A1-', 'A3-'], CROUCH: ['A1+', 'A3+'] }
const PRESS = 0.5, RELEASE = 0.35
const PLAYERS: readonly PlayerSlotId[] = ['P1', 'P2']

/** 遲滯：達 0.5 才按下、低於 0.35 才放開，類比與按鈕 value 都一樣，邊界值不會抖動。 */
export const samplePads = (pads: readonly (GamepadLike | null | undefined)[], previous: PadDown = new Map()): Map<number, Set<PadCode>> => {
  const now = new Map<number, Set<PadCode>>()
  pads.forEach((pad, index) => {
    if (!pad || pad.connected === false) return
    const was = previous.get(index), down = new Set<PadCode>()
    const add = (code: PadCode, level: number): void => { if (level >= PRESS || (was?.has(code) && level >= RELEASE)) down.add(code) }
    // 數位按鈕常只給 pressed；扳機的 pressed 門檻由瀏覽器決定，所以有 value 時以 value 為準。
    pad.buttons?.forEach((button, b) => add(`B${b}`, button.value || (button.pressed ? 1 : 0)))
    pad.axes?.forEach((value, a) => { add(`A${a}+`, value); add(`A${a}-`, -value) })
    now.set(index, down)
  })
  return now
}

/** 下一幀的 previous：斷線的 index 保留最後按住的鍵，重新連上時仍按著的鍵要放開過一次才算新按下（不會拿來取得所有權或出招）。 */
export const rememberPads = (previous: PadDown, now: PadDown): PadDown => new Map([...previous, ...now])

/** 斷線（不在 now）即釋放；未被擁有的手把有按鈕新按下時取得空位（先 1P 再 2P）。搖桿推動不算。 */
export const updateSlots = (slots: PadSlots, now: PadDown, previous: PadDown): PadSlots => {
  const next: PadSlots = { P1: slots.P1 !== undefined && now.has(slots.P1) ? slots.P1 : undefined, P2: slots.P2 !== undefined && now.has(slots.P2) ? slots.P2 : undefined }
  now.forEach((down, index) => {
    const free = PLAYERS.find((id) => next[id] === undefined)
    if (!free || next.P1 === index || next.P2 === index) return
    if ([...down].some((code) => code.startsWith('B') && !previous.get(index)?.has(code))) next[free] = index
  })
  return next
}

/** 固定的系統鍵，不可綁定：R1＝返回，L3＝在 P0 開啟 CONTROLS。 */
export const PAD_SYSTEM = { BACK: 'B5', CONTROLS: 'B10' } as const satisfies Record<string, PadCode>
const SYSTEM_CODES = new Set<string>(Object.values(PAD_SYSTEM))

const CODE = /^(?:B(\d{1,2})|A(\d{1,2})([+-]))$/
// 軸 0–3 已固定併入方向（ANALOG_DIRECTIONS），再綁到動作會讓走路同時出拳、選單導航同時確認。
const STICK_CODES = new Set<string>(Object.values(ANALOG_DIRECTIONS).flat())
export const padProblem = (code: string): string | undefined => !CODE.test(code) ? 'UNKNOWN INPUT' : STICK_CODES.has(code) ? 'STICK IS FIXED TO DIRECTIONS' : SYSTEM_CODES.has(code) ? `${padLabel(code)} IS RESERVED` : undefined
// 機台面板的 PS 標示，依 standard mapping 位置對應（Windows 以 XInput 辨識：A↔✕、B↔○、X↔□、Y↔△…，待實機確認）。
// 用 ⭘ ▢ 🛆 而非 ○ □ △：後者在遊戲字型下由系統補字，只有 ✕ 的一半大，機台螢幕上看不清楚。
const BUTTON_NAMES = ['✕', '⭘', '▢', '🛆', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', '↑', '↓', '←', '→']
const STICK_NAMES: Record<string, string> = { 'A0-': 'LS ←', 'A0+': 'LS →', 'A1-': 'LS ↑', 'A1+': 'LS ↓', 'A2-': 'RS ←', 'A2+': 'RS →', 'A3-': 'RS ↑', 'A3+': 'RS ↓' }
export const padLabel = (code: string): string => {
  const [, button, axis, sign] = CODE.exec(code) ?? []
  if (button !== undefined) return BUTTON_NAMES[Number(button)] ?? `BTN ${button}`
  return axis === undefined ? code : STICK_NAMES[code] ?? `AXIS ${axis}${sign}`
}

/** 同一玩家不可重複；兩位玩家是不同手把，不互相檢查。 */
export const PAD_RULES: KeyRules<PadCode> = { problem: padProblem, label: padLabel, defaults: { P1: DEFAULT_PAD_BINDINGS, P2: DEFAULT_PAD_BINDINGS } }

const validPad = (value: unknown): value is PadBindings => {
  if (!value || typeof value !== 'object') return false
  const codes = COMBAT_ACTIONS.map((action) => (value as Record<string, unknown>)[action])
  return codes.every((code) => typeof code === 'string' && !padProblem(code)) && new Set(codes).size === codes.length
}
const pickPad = (value: unknown): PadBindings => validPad(value) ? Object.fromEntries(COMBAT_ACTIONS.map((action) => [action, value[action]])) as PadBindings : { ...DEFAULT_PAD_BINDINGS }

/** 缺少、損壞、版本不符、不完整或重複時，該玩家退回預設。 */
export const loadPadProfiles = (store = browserStore()): PadProfiles => {
  let saved: { version?: unknown; profiles?: Partial<Record<PlayerSlotId, unknown>> } | null = null
  try { saved = JSON.parse(store?.getItem(PAD_STORAGE_KEY) ?? 'null') } catch { /* 損壞 → 預設 */ }
  const profiles = saved?.version === 1 && saved.profiles && typeof saved.profiles === 'object' ? saved.profiles : {}
  return { P1: pickPad(profiles.P1), P2: pickPad(profiles.P2) }
}
export const savePadProfiles = (profiles: PadProfiles, store = browserStore()): boolean => {
  if (!validPad(profiles.P1) || !validPad(profiles.P2)) return false
  try { store?.setItem(PAD_STORAGE_KEY, JSON.stringify({ version: 1, profiles })); return Boolean(store) } catch { return false }
}
