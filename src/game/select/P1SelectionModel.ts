import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'
import type { PlayerSelection } from '../app/ExperienceContext'
import { AI_PROFILE_IDS, DEFAULT_AI_PROFILE, type AiProfileId } from '../config/aiProfiles'
import { bodyTemplates, characterEntries, type CharacterEntry, type SlotStatus, type SlotType } from '../ui/assets/TestAssetManifest'

export const GRID_COLUMNS = 10
// 名錄 2 排＝最多顯示 20 位已生成角色。
export const GRID_ROWS = 3
export const SLOT_COUNT = GRID_COLUMNS * GRID_ROWS
export const NICKNAME_MAX = 16

/** 玩家區最前面的固定格數（11–15），其餘 15 格給最新生成的角色。 */
export const PINNED_SLOTS = 5

export type Slot = { index: number; type: SlotType; status?: SlotStatus; entry?: CharacterEntry; pinned?: true }
// NAME＝輸入暱稱頁；CUSTOMIZE＝拍照頁（UX v03 UC02-4／UC03-1：暱稱與拍照分兩屏）。
export type P1Phase = 'GRID' | 'OPPONENT' | 'DIFFICULTY' | 'NAME' | 'CUSTOMIZE' | 'REVIEW' | 'PROCESSING' | 'FAILED' | 'ALL_READY'
export type GenerationState = 'PHOTO_CONFIRMED' | 'REQUESTING' | 'PROCESSING' | 'API_READY' | 'DOWNLOADING' | 'DECODED' | 'RUNTIME_READY' | 'FAILED'
export type PlayerStatus = 'JOIN' | 'SELECTING' | 'READY' | 'WAITING' | 'CUSTOMIZE' | 'OPPONENT' | 'DIFFICULTY' | 'CPU_READY'
export type OpponentChoice = { characterId: string; difficulty: AiProfileId }
export type SelectFeedback = 'REJECTED' | 'JOIN_HINT' | 'NAME_REQUIRED' | 'FACE_GENERATION_USED' | 'NAME_TAKEN'
export type SelectionInputResult = SelectFeedback | 'CONFIRMED'
// photo：本機擷取的 dataURL，只存在記憶體、不進 result()／API。
type PlayerState = { joined: boolean; cursor: number; locked?: number; nickname: string; customized: boolean; faceGenUsed?: boolean; generation?: GenerationState; photo?: string }
export type P1SelectionSeed = { players?: Partial<Record<PlayerSlotId, PlayerSelection>>; faceGenUsed?: Partial<Record<PlayerSlotId, boolean>> }

const players: readonly PlayerSlotId[] = ['P1', 'P2']

// 區段索引帶：CUSTOMIZE 01–04、OFFICERS 05–10（補滿第 1 列）、ROSTER 11–30。編號與導覽不因分區改變。
export type SectionId = 'CUSTOMIZE' | 'OFFICERS' | 'ROSTER'
export const SECTIONS: readonly { id: SectionId; from: number; to: number }[] = [
  { id: 'CUSTOMIZE', from: 1, to: 4 }, { id: 'OFFICERS', from: 5, to: 10 }, { id: 'ROSTER', from: 11, to: SLOT_COUNT },
]
export const sectionOf = (index: number): SectionId => (SECTIONS.find((section) => index <= section.to) ?? SECTIONS[2]).id
export const sectionCounts = (slots: readonly Slot[]): Record<SectionId, { used: number; total: number }> =>
  Object.fromEntries(SECTIONS.map(({ id, from, to }) => [id, { used: slots.slice(from - 1, to).filter((slot) => slot.entry).length, total: to - from + 1 }])) as Record<SectionId, { used: number; total: number }>

export const selectSectionTitles = (slots: readonly Slot[]) => {
  const { ROSTER } = sectionCounts(slots)
  return {
    body: '化身鬥士 ×4 ｜ 拍照換臉',
    saga: 'ROG SAGA 英雄 ×2',
    guest: '特邀鬥士 ×4 ｜ 直接參戰',
    roster: `參戰者名錄 ｜ FIGHTER ROSTER ｜ ${ROSTER.used} / ${ROSTER.total}`,
  }
}

// 01–04 永遠是 Body Template；FEATURED 依序填 05–10；11–15 固定玩家（缺的留空位）；超過的 FEATURED 與已生成角色從 16 起。其餘為 EMPTY（不得補假角色）。
// 已生成角色由舊到新傳入；超過名錄容量時只顯示最新的，剛生成的角色才不會被擠出畫面。有傳入隱藏角色時多一格 31。
export const buildSlots = (entries: readonly CharacterEntry[] = characterEntries()): Slot[] => {
  const bodies = bodyTemplates.map((template) => entries.find((entry) => entry.type === 'BODY_TEMPLATE' && entry.bodyTemplateId === template.bodyTemplateId) ?? template)
  const officers = SECTIONS[1].to - SECTIONS[1].from + 1, pad = (n: number) => Array<undefined>(Math.max(0, n))
  const featured = entries.filter((entry) => entry.type === 'FEATURED'), pinned = entries.filter((entry) => entry.roster === 'PINNED').slice(0, PINNED_SLOTS)
  const generated = entries.filter((entry) => entry.type !== 'FEATURED' && entry.type !== 'BODY_TEMPLATE' && !entry.roster), hidden = entries.find((entry) => entry.roster === 'HIDDEN')
  const room = SLOT_COUNT - SECTIONS[1].to - PINNED_SLOTS - featured.slice(officers).length
  const placed: (CharacterEntry | undefined)[] = [...featured.slice(0, officers), ...pad(officers - featured.length), ...pinned, ...pad(PINNED_SLOTS - pinned.length), ...featured.slice(officers), ...generated.slice(Math.max(0, generated.length - room))]
  const slots = Array.from({ length: SLOT_COUNT }, (_, i): Slot => {
    const entry = i < 4 ? bodies[i] : placed[i - 4], pin = i >= SECTIONS[1].to && i < SECTIONS[1].to + PINNED_SLOTS ? { pinned: true as const } : {}
    return entry ? { index: i + 1, type: entry.type, status: entry.status, entry, ...pin } : { index: i + 1, type: i < 4 ? 'BODY_TEMPLATE' : 'EMPTY', ...pin }
  })
  return hidden ? [...slots, { index: SLOT_COUNT + 1, type: hidden.type, status: hidden.status, entry: hidden }] : slots
}

// 沿用 focus-navigation 的 wrap 語意：左右 row-major 跨列循環（含隱藏第 31 格），上下同欄循環；第 31 格只能左右進出。
export const moveSlot = (index: number, action: OwnedUiAction, count = SLOT_COUNT): number => {
  const step = action === 'NAV_LEFT' ? -1 : action === 'NAV_RIGHT' ? 1 : action === 'NAV_UP' ? -GRID_COLUMNS : action === 'NAV_DOWN' ? GRID_COLUMNS : 0
  if (index > SLOT_COUNT) return step === -1 ? SLOT_COUNT : step === 1 ? 1 : index
  const size = Math.abs(step) === 1 ? count : SLOT_COUNT
  return ((index - 1 + step) % size + size) % size + 1
}

export const confirmable = (slot: Slot): boolean => Boolean(slot.entry) && (slot.status === 'AVAILABLE' || slot.status === 'READY')

export class P1SelectionModel {
  readonly slots: Slot[]
  phase: P1Phase = 'GRID'
  owner?: PlayerSlotId
  /** 單人模式的 CPU 對手：1P 用自己的方向鍵移動；存在＝正在選或已選對手。 */
  rival?: { cursor: number; difficulty: AiProfileId }
  private readonly state: Record<PlayerSlotId, PlayerState> = {
    P1: { joined: true, cursor: 5, nickname: '', customized: false },
    P2: { joined: false, cursor: 6, nickname: '', customized: false },
  }

  constructor(entries?: readonly CharacterEntry[], seed: P1SelectionSeed = {}) {
    this.slots = buildSlots(entries)
    players.forEach((id) => {
      const saved = seed.players?.[id], state = this.state[id]
      state.faceGenUsed = Boolean(seed.faceGenUsed?.[id])
      if (saved) {
        const cursor = this.slots.findIndex((slot) => slot.entry?.id === saved.characterId)
        if (cursor >= 0) state.cursor = cursor + 1
        state.nickname = saved.nickname ?? ''
        if (id === 'P2') state.joined = true
      }
    })
  }

  player(id: PlayerSlotId): Readonly<PlayerState> { return this.state[id] }
  slot(index: number): Slot { return this.slots[index - 1] }
  /** Hero 顯示的格子：鎖定後固定，否則跟隨 Focus。 */
  heroSlot(id: PlayerSlotId): Slot | undefined { const p = this.state[id]; return p.joined ? this.slot(p.locked ?? p.cursor) : id === 'P2' && this.rival ? this.slot(this.rival.cursor) : undefined }
  isBody(id: PlayerSlotId): boolean { const locked = this.state[id].locked; return locked !== undefined && this.slot(locked).type === 'BODY_TEMPLATE' }
  isReady(id: PlayerSlotId): boolean { const p = this.state[id]; return p.joined && p.locked !== undefined && (!this.isBody(id) || p.customized) }
  /** 同一局 2P 不得與 1P 同名（UX v03 UC02-4）；1P 先輸入，不需檢查。 */
  nicknameTaken(id: PlayerSlotId): boolean { return id === 'P2' && this.state.P1.nickname.trim() !== '' && this.state.P1.nickname.trim().toLowerCase() === this.state.P2.nickname.trim().toLowerCase() }
  nicknameValid(id: PlayerSlotId): boolean { const length = this.state[id].nickname.trim().length; return length > 0 && length <= NICKNAME_MAX }
  setNickname(id: PlayerSlotId, name: string): void { this.state[id].nickname = name.slice(0, NICKNAME_MAX) }
  setPhoto(id: PlayerSlotId, photo: string | undefined): void { this.state[id].photo = photo }

  status(id: PlayerSlotId): PlayerStatus {
    if (!this.state[id].joined) return this.rival ? this.phase === 'OPPONENT' || this.phase === 'DIFFICULTY' ? this.phase : 'CPU_READY' : 'JOIN'
    if (this.owner === id) return 'CUSTOMIZE'
    if (this.isReady(id)) return this.phase === 'GRID' || this.phase === 'ALL_READY' ? 'READY' : 'WAITING'
    return this.state[id].locked !== undefined ? 'WAITING' : 'SELECTING'
  }

  /** 尚待拍照的玩家（1P 優先）。 */
  queue(): PlayerSlotId[] { return players.filter((id) => this.state[id].joined && this.isBody(id) && !this.state[id].customized) }

  focus(id: PlayerSlotId, index: number): boolean {
    const p = this.state[id]
    if (!Number.isInteger(index) || index < 1 || index > this.slots.length || this.phase !== 'GRID' || !p.joined || p.locked !== undefined || p.cursor === index) return false
    p.cursor = index; return true
  }

  input(id: PlayerSlotId, action: OwnedUiAction): SelectionInputResult | undefined {
    if (this.phase === 'FAILED') {
      if (id === this.owner && action === 'BACK') this.abortCustomize()
      else if (id === this.owner && action === 'CONFIRM') return 'FACE_GENERATION_USED'
      return undefined
    }
    if (this.phase === 'PROCESSING') return undefined
    if (this.phase === 'NAME' || this.phase === 'CUSTOMIZE' || this.phase === 'REVIEW') {
      if (id !== this.owner) return undefined
      if (this.phase === 'NAME' && action === 'CONFIRM') {
        if (!this.nicknameValid(id)) return 'NAME_REQUIRED'
        if (this.nicknameTaken(id)) return 'NAME_TAKEN'
        this.phase = 'CUSTOMIZE'; return 'CONFIRMED'
      }
      else if (this.phase === 'NAME' && action === 'BACK') this.abortCustomize()
      else if (this.phase === 'CUSTOMIZE' && action === 'CONFIRM') { if (this.state[id].faceGenUsed) return 'FACE_GENERATION_USED'; if (!this.nicknameValid(id)) return 'NAME_REQUIRED'; this.phase = 'REVIEW'; return 'CONFIRMED' }
      else if (this.phase === 'CUSTOMIZE' && action === 'BACK') this.phase = 'NAME'
      else if (this.phase === 'REVIEW' && action === 'CONFIRM') {
        if (this.state[id].faceGenUsed) return 'FACE_GENERATION_USED'
        this.state[id].faceGenUsed = true; this.state[id].generation = 'PHOTO_CONFIRMED'; this.phase = 'PROCESSING'; return 'CONFIRMED'
      }
      else if (this.phase === 'REVIEW' && action === 'BACK') this.phase = 'CUSTOMIZE'
      return undefined
    }
    const p = this.state[id]
    if (!p.joined) {
      if (id !== 'P2' || action !== 'CONFIRM') return 'JOIN_HINT'
      p.joined = true; p.cursor = 6; this.rival = undefined; this.phase = 'GRID'; return 'CONFIRMED'
    }
    if (this.rival && id === 'P1') return this.rivalInput(action)
    if (action === 'BACK') {
      if (p.locked !== undefined) { this.unlock(id); this.phase = 'GRID' }
      else if (id === 'P2' && this.phase === 'GRID') { p.joined = false; this.advance() }
      return undefined
    }
    if (this.phase !== 'GRID' || p.locked !== undefined) return undefined
    if (action !== 'CONFIRM') { p.cursor = moveSlot(p.cursor, action, this.slots.length); return undefined }
    if (!confirmable(this.slot(p.cursor))) return 'REJECTED'
    p.locked = p.cursor; this.advance(); return 'CONFIRMED'
  }

  completeProcessing(): void {
    this.setGenerationState('RUNTIME_READY')
  }

  continueProcessing(): void {
    if (this.phase !== 'PROCESSING' || !this.owner) return
    this.state[this.owner].customized = true; this.state[this.owner].generation = 'PROCESSING'
    this.owner = undefined; this.phase = 'GRID'; this.advance()
  }

  skipCustomize(): void {
    if (this.phase !== 'CUSTOMIZE' || !this.owner) return
    this.state[this.owner].customized = true; this.state[this.owner].photo = undefined; this.owner = undefined; this.phase = 'GRID'; this.advance()
  }

  setGenerationState(state: GenerationState): void {
    if (this.phase !== 'PROCESSING' || !this.owner) return
    this.state[this.owner].generation = state
    if (state === 'FAILED') { this.phase = 'FAILED'; return }
    if (state !== 'RUNTIME_READY') return
    this.state[this.owner].customized = true; this.state[this.owner].photo = undefined; this.owner = undefined; this.phase = 'GRID'; this.advance()
  }

  /** Customize 中返回或逾時：只解鎖 owner，另一位的鎖定與 READY 保留。 */
  abortCustomize(): void {
    if (!this.owner) return
    this.unlock(this.owner); this.owner = undefined; this.phase = 'GRID'
  }

  result(): Partial<Record<PlayerSlotId, PlayerSelection>> {
    return Object.fromEntries(players.filter((id) => this.isReady(id)).map((id) => {
      const entry = this.slot(this.state[id].locked as number).entry as CharacterEntry
      const nickname = this.state[id].nickname.trim()
      return [id, this.isBody(id) || nickname ? { characterId: entry.id, nickname } : { characterId: entry.id }]
    }))
  }

  private unlock(id: PlayerSlotId): void { if (id === 'P1') this.rival = undefined; this.state[id].locked = undefined; this.state[id].customized = false; this.state[id].generation = undefined; this.state[id].photo = undefined }

  private advance(): void {
    if (this.phase !== 'GRID' || players.some((id) => this.state[id].joined && this.state[id].locked === undefined)) return
    const next = this.queue()[0]
    if (next) { this.owner = next; this.phase = 'NAME' } else if (this.state.P2.joined) this.phase = 'ALL_READY'
    else { this.rival ??= { cursor: this.defaultRival(this.state.P1.locked as number), difficulty: DEFAULT_AI_PROFILE.id }; this.phase = 'OPPONENT' }
  }

  /** CPU 預設對手：1P 之後的下一位 Officer（循環），不預選 Body 模板或空格。 */
  private defaultRival(locked: number): number {
    const { from, to } = SECTIONS[1], officers = Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((index) => index !== locked && confirmable(this.slot(index)))
    return officers.find((index) => index > locked) ?? officers[0] ?? moveSlot(locked, 'NAV_RIGHT', this.slots.length)
  }

  /** 單人：OPPONENT（選格）→ DIFFICULTY（←→ 切換）→ ALL_READY；BACK 逐層退回，OPPONENT 再退即解除 1P 鎖定。 */
  private rivalInput(action: OwnedUiAction): SelectionInputResult | undefined {
    const rival = this.rival as NonNullable<P1SelectionModel['rival']>
    if (this.phase === 'OPPONENT') {
      if (action === 'BACK') { this.unlock('P1'); this.phase = 'GRID' }
      else if (action !== 'CONFIRM') rival.cursor = moveSlot(rival.cursor, action, this.slots.length)
      else if (!confirmable(this.slot(rival.cursor)) || rival.cursor === this.state.P1.locked) return 'REJECTED'
      else { this.phase = 'DIFFICULTY'; return 'CONFIRMED' }
    } else if (this.phase === 'DIFFICULTY') {
      if (action === 'BACK') this.phase = 'OPPONENT'
      else if (action === 'CONFIRM') { this.phase = 'ALL_READY'; return 'CONFIRMED' }
      else if (action === 'NAV_LEFT' || action === 'NAV_RIGHT') rival.difficulty = AI_PROFILE_IDS[(AI_PROFILE_IDS.indexOf(rival.difficulty) + (action === 'NAV_RIGHT' ? 1 : AI_PROFILE_IDS.length - 1)) % AI_PROFILE_IDS.length]
    } else if (this.phase === 'ALL_READY' && action === 'BACK') this.phase = 'DIFFICULTY'
    return undefined
  }

  /** 單人且已全員 ready 時的對手選擇；雙人時對手外觀來自 2P。 */
  opponent(): OpponentChoice | undefined {
    const entry = this.rival && this.phase === 'ALL_READY' ? this.slot(this.rival.cursor).entry : undefined
    return entry && this.rival ? { characterId: entry.id, difficulty: this.rival.difficulty } : undefined
  }
}
