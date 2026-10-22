/**
 * 敵方 AI 難度與行為參數；只改這個檔案即可調整手感。單位：world px／tick（24Hz）。
 * spacing：玩家攻擊距離「之外」的間距帶，AI 平時在帶內進退而不貼身。
 */
export type AiProfileId = 'EASY' | 'NORMAL' | 'HARD'
export type AiProfile = {
  id: AiProfileId
  spacingMin: number // 間距帶近端（距攻擊距離）；比這更近就退開
  spacingMax: number // 間距帶遠端；比這更遠就推進
  aggression: number // 每次決策突進出招的機率 0–1
  guardChance: number // 玩家出招時防禦的機率 0–1（每一招只擲一次）
  retreatTicks: number // 出招後後退的 tick 數
  attackCooldownTicks: number // 兩次出招之間的最短間隔
  decisionTicks: number // 決策週期；越小反應越快
}

export const AI_PROFILES: Readonly<Record<AiProfileId, AiProfile>> = {
  EASY: { id: 'EASY', spacingMin: 60, spacingMax: 260, aggression: 0.25, guardChance: 0.1, retreatTicks: 18, attackCooldownTicks: 24, decisionTicks: 16 },
  NORMAL: { id: 'NORMAL', spacingMin: 40, spacingMax: 220, aggression: 0.45, guardChance: 0.3, retreatTicks: 10, attackCooldownTicks: 12, decisionTicks: 10 },
  HARD: { id: 'HARD', spacingMin: 20, spacingMax: 160, aggression: 0.7, guardChance: 0.5, retreatTicks: 5, attackCooldownTicks: 6, decisionTicks: 6 },
}
export const AI_PROFILE_IDS: readonly AiProfileId[] = ['EASY', 'NORMAL', 'HARD']
export const DEFAULT_AI_PROFILE: AiProfile = AI_PROFILES.NORMAL
export const resolveAiProfile = (id?: string): AiProfile => AI_PROFILES[id as AiProfileId] ?? DEFAULT_AI_PROFILE
