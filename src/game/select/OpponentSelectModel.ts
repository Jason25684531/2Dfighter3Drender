import { AI_PROFILE_IDS, DEFAULT_AI_PROFILE, type AiProfileId } from '../config/aiProfiles'
import { characterEntries, type CharacterEntry } from '../ui/assets/TestAssetManifest'

export type OpponentChoice = { characterId: string; difficulty: AiProfileId }

/** 1P 選對手：候選＝可用角色（含 Body），排除 1P 自己；選定後可取消重選，NEXT 只在已選定時可用。 */
export class OpponentSelectModel {
  readonly candidates: readonly CharacterEntry[]
  cursor = 0
  difficulty: AiProfileId = DEFAULT_AI_PROFILE.id
  private lockedIndex?: number

  constructor(entries: readonly CharacterEntry[] = characterEntries(), excludeId?: string, preset?: OpponentChoice) {
    this.candidates = entries.filter((entry) => entry.id !== excludeId && (entry.status === 'AVAILABLE' || entry.status === 'READY'))
    const index = this.candidates.findIndex((entry) => entry.id === preset?.characterId)
    if (preset && index >= 0) { this.cursor = index; this.lockedIndex = index; this.difficulty = preset.difficulty }
  }

  get locked(): CharacterEntry | undefined { return this.lockedIndex === undefined ? undefined : this.candidates[this.lockedIndex] }
  canProceed(): boolean { return this.lockedIndex !== undefined }
  focus(index: number): boolean { if (!Number.isInteger(index) || index < 0 || index >= this.candidates.length) return false; this.cursor = index; return true }
  select(index = this.cursor): boolean { if (!this.focus(index)) return false; this.lockedIndex = index; return true }
  /** 取消已選定的對手；回傳是否真的取消（供 BACK 判斷要留下還是離開）。 */
  cancel(): boolean { if (this.lockedIndex === undefined) return false; this.lockedIndex = undefined; return true }
  cycleDifficulty(): AiProfileId { this.difficulty = AI_PROFILE_IDS[(AI_PROFILE_IDS.indexOf(this.difficulty) + 1) % AI_PROFILE_IDS.length]; return this.difficulty }
  result(): OpponentChoice | undefined { const entry = this.locked; return entry ? { characterId: entry.id, difficulty: this.difficulty } : undefined }
}
