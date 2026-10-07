import type { SessionStatus } from '../api/ApiTypes'

export type PersistenceState = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ExperienceContextData = { playerId?: number; sessionId?: number; sessionStatus?: SessionStatus; matchId?: number; persistence: PersistenceState; backendRank?: number | null }

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
