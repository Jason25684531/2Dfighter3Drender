import type { SpriteId } from '../animation/TemporarySpriteManifest'

export type StageId = 'laboratory' | 'company-building'
export const stageTextureKey = (id: StageId): string => `stage-${id}`

export const testStageManifest: Record<StageId, { id: StageId; label: string; url: string }> = {
  laboratory: { id: 'laboratory', label: 'LABORATORY', url: '/test-assets/stages/laboratory.png' },
  'company-building': { id: 'company-building', label: 'COMPANY BUILDING', url: '/test-assets/stages/company-building.png' },
}

export type SlotType = 'BODY_TEMPLATE' | 'FEATURED' | 'CUSTOM' | 'EMPTY'
export type SlotStatus = 'AVAILABLE' | 'PROCESSING' | 'READY' | 'FAILED'
/** roster：PINNED＝玩家區固定格（不隨生成輪替）；HIDDEN＝P0 連按三次 L1 才出現的第 31 格。 */
export type CharacterEntry = { id: string; displayName: string; type: Exclude<SlotType, 'EMPTY'>; status: SlotStatus; spriteId?: SpriteId; bodyTemplateId?: string; generationId?: string; roster?: 'PINNED' | 'HIDDEN' }

// 長官區 05–10，依序填格：GO、SE7EN、Joneey、YG、Tony、Chris。
export const testCharacterManifest = {
  presetC: { id: 'preset-c', displayName: 'GO', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'go' },
  presetF: { id: 'preset-f', displayName: 'SE7EN', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'se7en' },
  presetG: { id: 'preset-g', displayName: 'Joneey', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'joneey' },
  presetH: { id: 'preset-h', displayName: 'YG', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'yg' },
  presetA: { id: 'preset-a', displayName: 'Tony', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'tony' },
  presetB: { id: 'preset-b', displayName: 'Chris', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'chris' },
} as const satisfies Record<string, CharacterEntry>

// Body 01–04 依序對應 S1AW／S2AM／S2LW／S3WW 正式身形；選角畫面一律畫剪影（shared-ia §4.4）。
// ponytail: ComfyUI 模板 3 已改 S1AM，但遊戲端沒有 S1AM 對齊圖集，跳過拍照的 Body 03 暫用 S2LW；美術提供後換掉。
const bodySprites: readonly SpriteId[] = ['s1aw', 's2am', 's2lw', 's3ww']
export const bodyTemplates: readonly CharacterEntry[] = bodySprites.map((spriteId, i) => ({ id: `body-0${i + 1}`, displayName: `BODY 0${i + 1}`, type: 'BODY_TEMPLATE', status: 'AVAILABLE', spriteId, bodyTemplateId: `body-0${i + 1}` }))

// 玩家區 11–15 固定：HW、HSI、JF、Grace，第 15 格保留給稍後匯入的第 5 位（到時加一筆即可）。
const pinned = (displayName: string, spriteId: SpriteId): CharacterEntry => ({ id: `pinned-${spriteId}`, displayName, type: 'CUSTOM', status: 'AVAILABLE', spriteId, roster: 'PINNED' })
export const pinnedPlayers: readonly CharacterEntry[] = [pinned('HW', 'hw'), pinned('HSI', 'hsi'), pinned('JF', 'jf'), pinned('Grace', 'grace')]
export const hiddenCharacter: CharacterEntry = { id: 'hidden-jeansen', displayName: 'Jeansen', type: 'CUSTOM', status: 'AVAILABLE', spriteId: 'jeansen', roster: 'HIDDEN' }

export const characterEntries = (): CharacterEntry[] => [...bodyTemplates, ...Object.values(testCharacterManifest), ...pinnedPlayers]
export const characterEntry = (id: string | undefined): CharacterEntry | undefined => [...characterEntries(), hiddenCharacter].find((entry) => entry.id === id)

export const resolveStageAsset = (id: string | undefined): typeof testStageManifest[StageId] => testStageManifest[id as StageId] ?? testStageManifest.laboratory
