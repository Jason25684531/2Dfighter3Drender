import type { SpriteId } from '../animation/TemporarySpriteManifest'

export type StageId = 'laboratory' | 'company-building'
export const stageTextureKey = (id: StageId): string => `stage-${id}`

export const testStageManifest: Record<StageId, { id: StageId; label: string; url: string }> = {
  laboratory: { id: 'laboratory', label: 'LABORATORY', url: '/test-assets/stages/laboratory.png' },
  'company-building': { id: 'company-building', label: 'COMPANY BUILDING', url: '/test-assets/stages/company-building.png' },
}

export type SlotType = 'BODY_TEMPLATE' | 'FEATURED' | 'CUSTOM' | 'EMPTY'
export type SlotStatus = 'AVAILABLE' | 'PROCESSING' | 'READY' | 'FAILED'
export type CharacterEntry = { id: string; displayName: string; type: Exclude<SlotType, 'EMPTY'>; status: SlotStatus; spriteId?: SpriteId; heroTextureKey?: string; bodyTemplateId?: string; generationId?: string }

export const testCharacterManifest = {
  presetA: { id: 'preset-a', displayName: 'Tony', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'tony' },
  presetB: { id: 'preset-b', displayName: 'Chris', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'chris' },
  presetC: { id: 'preset-c', displayName: 'GO', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'go' },
  presetF: { id: 'preset-f', displayName: 'SE7EN', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'se7en' },
  presetD: { id: 'preset-d', displayName: 'KEVIN', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'kevin' },
  presetE: { id: 'preset-e', displayName: 'CUSTOM01', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'body01' },
} as const satisfies Record<string, CharacterEntry>

// Body 01–04 依序對應 S1AW／S2AM／S2LW／S3WW 正式身形；選角畫面一律畫剪影（shared-ia §4.4）。
const bodySprites: readonly SpriteId[] = ['s1aw', 's2am', 's2lw', 's3ww']
export const bodyTemplates: readonly CharacterEntry[] = bodySprites.map((spriteId, i) => ({ id: `body-0${i + 1}`, displayName: `BODY 0${i + 1}`, type: 'BODY_TEMPLATE', status: 'AVAILABLE', spriteId, bodyTemplateId: `body-0${i + 1}` }))

export const characterEntries = (): CharacterEntry[] => [...bodyTemplates, ...Object.values(testCharacterManifest)]
export const characterEntry = (id: string | undefined): CharacterEntry | undefined => characterEntries().find((entry) => entry.id === id)

export const resolveStageAsset = (id: string | undefined): typeof testStageManifest[StageId] => testStageManifest[id as StageId] ?? testStageManifest.laboratory
