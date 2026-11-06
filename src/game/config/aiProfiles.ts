/**
 * 敵方 AI 難度與行為參數；只改這個檔案即可調整手感。單位：world px／tick（24Hz）。
 * spacing：從「兩人輪廓貼身」的距離往外算的間距帶，AI 平時在帶內進退（沒有輪廓時從 AABB 攻擊距離起算）。
 * 防禦只來自 guardChance：玩家出招中 AI 不會因撤退／保持間距而「順便」後退防禦（EnemyAI.getIntent）。
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
  // 2026-11-05 EASY：不主動退開（spacingMin 0），玩家可以走到貼身；出招更少、出招後只短暫退開。
  EASY: { id: 'EASY', spacingMin: 0, spacingMax: 140, aggression: 0.2, guardChance: 0.05, retreatTicks: 6, attackCooldownTicks: 30, decisionTicks: 18 },
  NORMAL: { id: 'NORMAL', spacingMin: 20, spacingMax: 150, aggression: 0.45, guardChance: 0.15, retreatTicks: 6, attackCooldownTicks: 12, decisionTicks: 10 },
  HARD: { id: 'HARD', spacingMin: 10, spacingMax: 120, aggression: 0.7, guardChance: 0.3, retreatTicks: 4, attackCooldownTicks: 6, decisionTicks: 6 },
}
export const AI_PROFILE_IDS: readonly AiProfileId[] = ['EASY', 'NORMAL', 'HARD']
export const DEFAULT_AI_PROFILE: AiProfile = AI_PROFILES.NORMAL
export const resolveAiProfile = (id?: string): AiProfile => AI_PROFILES[id as AiProfileId] ?? DEFAULT_AI_PROFILE
