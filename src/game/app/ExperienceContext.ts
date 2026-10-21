import type { SessionStatus } from '../api/ApiTypes'
import type { PlayerSlotId } from '../input/InputManager'

export type PersistenceState = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
// 1P/2P 選角結果只存前端（D-08）；selectedCharacterId 保留為 1P 相容欄位。
export type PlayerSelection = { characterId: string; nickname?: string }
export type ExperienceContextData = { players?: Partial<Record<PlayerSlotId, PlayerSelection>>; playerId?: number; sessionId?: number; sessionStatus?: SessionStatus; matchId?: number; persistence: PersistenceState; backendRank?: number | null; selectedCharacterId?: string; selectedStageId?: string }

export class ExperienceContext {
  static readonly key = 'exp2.session'
  private data: ExperienceContextData = { persistence: 'IDLE' }
  get snapshot(): Readonly<ExperienceContextData> { return { ...this.data } }
  set(next: Partial<ExperienceContextData>): void { this.data = { ...this.data, ...next } }
  clear(): void { this.data = { persistence: 'IDLE' } }
  serialize(storage: StorageLike): void { storage.setItem(ExperienceContext.key, JSON.stringify(this.data)) }
  restore(storage: StorageLike): void { const raw = storage.getItem(ExperienceContext.key); if (raw) this.data = { ...this.data, ...JSON.parse(raw) as ExperienceContextData } }
  remove(storage: StorageLike): void { storage.removeItem(ExperienceContext.key); this.clear() }
}
