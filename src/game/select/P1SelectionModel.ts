import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'
import type { PlayerSelection } from '../app/ExperienceContext'
import { bodyTemplates, characterEntries, type CharacterEntry, type SlotStatus, type SlotType } from '../ui/assets/TestAssetManifest'

export const GRID_COLUMNS = 10
export const GRID_ROWS = 4
export const SLOT_COUNT = GRID_COLUMNS * GRID_ROWS
export const NICKNAME_MAX = 16

export type Slot = { index: number; type: SlotType; status?: SlotStatus; entry?: CharacterEntry }
export type P1Phase = 'GRID' | 'CUSTOMIZE' | 'REVIEW' | 'PROCESSING' | 'FAILED' | 'ALL_READY'
export type GenerationState = 'PHOTO_CONFIRMED' | 'REQUESTING' | 'PROCESSING' | 'API_READY' | 'DOWNLOADING' | 'DECODED' | 'RUNTIME_READY' | 'FAILED'
export type PlayerStatus = 'JOIN' | 'SELECTING' | 'READY' | 'WAITING' | 'CUSTOMIZE'
export type SelectFeedback = 'REJECTED' | 'JOIN_HINT' | 'NAME_REQUIRED'
// photo：本機擷取的 dataURL，只存在記憶體、不進 result()／API。
type PlayerState = { joined: boolean; cursor: number; locked?: number; nickname: string; customized: boolean; generation?: GenerationState; photo?: string }

const players: readonly PlayerSlotId[] = ['P1', 'P2']

// 區段索引帶：CUSTOMIZE 01–04、OFFICERS 05–10（補滿第 1 列）、ROSTER 11–40。編號與導覽不因分區改變。
export type SectionId = 'CUSTOMIZE' | 'OFFICERS' | 'ROSTER'
export const SECTIONS: readonly { id: SectionId; from: number; to: number }[] = [
  { id: 'CUSTOMIZE', from: 1, to: 4 }, { id: 'OFFICERS', from: 5, to: 10 }, { id: 'ROSTER', from: 11, to: SLOT_COUNT },
]
export const sectionOf = (index: number): SectionId => (SECTIONS.find((section) => index <= section.to) ?? SECTIONS[2]).id
export const sectionCounts = (slots: readonly Slot[]): Record<SectionId, { used: number; total: number }> =>
  Object.fromEntries(SECTIONS.map(({ id, from, to }) => [id, { used: slots.slice(from - 1, to).filter((slot) => slot.entry).length, total: to - from + 1 }])) as Record<SectionId, { used: number; total: number }>

// 01–04 永遠是 Body Template；FEATURED 依序填 05–10，超過的溢出到 ROSTER 起始；其餘（已生成）從 11 起。其餘為 EMPTY（不得補假角色）。
export const buildSlots = (entries: readonly CharacterEntry[] = characterEntries()): Slot[] => {
  const bodies = bodyTemplates.map((template) => entries.find((entry) => entry.type === 'BODY_TEMPLATE' && entry.bodyTemplateId === template.bodyTemplateId) ?? template)
  const officers = SECTIONS[1].to - SECTIONS[1].from + 1
  const featured = entries.filter((entry) => entry.type === 'FEATURED'), generated = entries.filter((entry) => entry.type !== 'FEATURED' && entry.type !== 'BODY_TEMPLATE')
  const placed: (CharacterEntry | undefined)[] = [...featured.slice(0, officers), ...Array<undefined>(Math.max(0, officers - featured.length)), ...featured.slice(officers), ...generated]
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const entry = i < 4 ? bodies[i] : placed[i - 4]
    return entry ? { index: i + 1, type: entry.type, status: entry.status, entry } : { index: i + 1, type: i < 4 ? 'BODY_TEMPLATE' : 'EMPTY' }
  })
}

// 沿用 focus-navigation 的 wrap 語意：左右 row-major 跨列循環，上下同欄循環。
export const moveSlot = (index: number, action: OwnedUiAction): number => {
  const step = action === 'NAV_LEFT' ? -1 : action === 'NAV_RIGHT' ? 1 : action === 'NAV_UP' ? -GRID_COLUMNS : action === 'NAV_DOWN' ? GRID_COLUMNS : 0
  return ((index - 1 + step) % SLOT_COUNT + SLOT_COUNT) % SLOT_COUNT + 1
}

export const confirmable = (slot: Slot): boolean => Boolean(slot.entry) && (slot.status === 'AVAILABLE' || slot.status === 'READY')

export class P1SelectionModel {
  readonly slots: Slot[]
  phase: P1Phase = 'GRID'
  owner?: PlayerSlotId
  private readonly state: Record<PlayerSlotId, PlayerState> = {
    P1: { joined: true, cursor: 5, nickname: '', customized: false },
    P2: { joined: false, cursor: 6, nickname: '', customized: false },
  }

  constructor(entries?: readonly CharacterEntry[]) { this.slots = buildSlots(entries) }

  player(id: PlayerSlotId): Readonly<PlayerState> { return this.state[id] }
  slot(index: number): Slot { return this.slots[index - 1] }
  /** Hero 顯示的格子：鎖定後固定，否則跟隨 Focus。 */
  heroSlot(id: PlayerSlotId): Slot | undefined { const p = this.state[id]; return p.joined ? this.slot(p.locked ?? p.cursor) : undefined }
  isBody(id: PlayerSlotId): boolean { const locked = this.state[id].locked; return locked !== undefined && this.slot(locked).type === 'BODY_TEMPLATE' }
  isReady(id: PlayerSlotId): boolean { const p = this.state[id]; return p.joined && p.locked !== undefined && (!this.isBody(id) || p.customized) }
  nicknameValid(id: PlayerSlotId): boolean { const length = this.state[id].nickname.trim().length; return length > 0 && length <= NICKNAME_MAX }
  setNickname(id: PlayerSlotId, name: string): void { this.state[id].nickname = name.slice(0, NICKNAME_MAX) }
  setPhoto(id: PlayerSlotId, photo: string | undefined): void { this.state[id].photo = photo }

  status(id: PlayerSlotId): PlayerStatus {
    if (!this.state[id].joined) return 'JOIN'
    if (this.owner === id) return 'CUSTOMIZE'
    if (this.isReady(id)) return this.phase === 'GRID' || this.phase === 'ALL_READY' ? 'READY' : 'WAITING'
    return this.state[id].locked !== undefined ? 'WAITING' : 'SELECTING'
  }

  /** 尚待拍照的玩家（1P 優先）。 */
  queue(): PlayerSlotId[] { return players.filter((id) => this.state[id].joined && this.isBody(id) && !this.state[id].customized) }

  focus(id: PlayerSlotId, index: number): boolean {
    const p = this.state[id]
    if (!Number.isInteger(index) || index < 1 || index > SLOT_COUNT || this.phase !== 'GRID' || !p.joined || p.locked !== undefined || p.cursor === index) return false
    p.cursor = index; return true
  }

  input(id: PlayerSlotId, action: OwnedUiAction): SelectFeedback | undefined {
    if (this.phase === 'FAILED') {
      if (id === this.owner && action === 'BACK') this.abortCustomize()
      else if (id === this.owner && action === 'CONFIRM') { this.state[id].generation = 'PHOTO_CONFIRMED'; this.phase = 'PROCESSING' }
      return undefined
    }
    if (this.phase === 'PROCESSING') return undefined
    if (this.phase === 'CUSTOMIZE' || this.phase === 'REVIEW') {
      if (id !== this.owner) return undefined
      if (this.phase === 'CUSTOMIZE' && action === 'CONFIRM') { if (!this.nicknameValid(id)) return 'NAME_REQUIRED'; this.phase = 'REVIEW' }
      else if (this.phase === 'CUSTOMIZE' && action === 'BACK') this.abortCustomize()
      else if (this.phase === 'REVIEW' && action === 'CONFIRM') { this.state[id].generation = 'PHOTO_CONFIRMED'; this.phase = 'PROCESSING' }
      else if (this.phase === 'REVIEW' && action === 'BACK') this.phase = 'CUSTOMIZE'
      return undefined
    }
    const p = this.state[id]
    if (!p.joined) {
      if (id !== 'P2' || action !== 'CONFIRM') return 'JOIN_HINT'
      p.joined = true; p.cursor = 6; this.phase = 'GRID'; return undefined
    }
    if (action === 'BACK') {
      if (p.locked !== undefined) { this.unlock(id); this.phase = 'GRID' }
      else if (id === 'P2' && this.phase === 'GRID') { p.joined = false; this.advance() }
      return undefined
    }
    if (this.phase !== 'GRID' || p.locked !== undefined) return undefined
    if (action !== 'CONFIRM') { p.cursor = moveSlot(p.cursor, action); return undefined }
    if (!confirmable(this.slot(p.cursor))) return 'REJECTED'
    p.locked = p.cursor; this.advance(); return undefined
  }

  completeProcessing(): void {
    this.setGenerationState('RUNTIME_READY')
  }

  setGenerationState(state: GenerationState): void {
    if (this.phase !== 'PROCESSING' || !this.owner) return
    this.state[this.owner].generation = state
    if (state === 'FAILED') { this.phase = 'FAILED'; return }
    if (state !== 'RUNTIME_READY') return
    this.state[this.owner].customized = true; this.owner = undefined; this.phase = 'GRID'; this.advance()
  }

  /** Customize 中返回或逾時：只解鎖 owner，另一位的鎖定與 READY 保留。 */
  abortCustomize(): void {
    if (!this.owner) return
    this.unlock(this.owner); this.owner = undefined; this.phase = 'GRID'
  }

  result(): Partial<Record<PlayerSlotId, PlayerSelection>> {
    return Object.fromEntries(players.filter((id) => this.isReady(id)).map((id) => {
      const entry = this.slot(this.state[id].locked as number).entry as CharacterEntry
      return [id, this.isBody(id) ? { characterId: entry.id, nickname: this.state[id].nickname.trim() } : { characterId: entry.id }]
    }))
  }

  private unlock(id: PlayerSlotId): void { this.state[id].locked = undefined; this.state[id].customized = false; this.state[id].generation = undefined; this.state[id].photo = undefined }

  private advance(): void {
    if (this.phase !== 'GRID' || players.some((id) => this.state[id].joined && this.state[id].locked === undefined)) return
    const next = this.queue()[0]
    if (next) { this.owner = next; this.phase = 'CUSTOMIZE' } else this.phase = 'ALL_READY'
  }
}
