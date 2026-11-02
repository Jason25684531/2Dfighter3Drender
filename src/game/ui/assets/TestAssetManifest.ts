import type { SpriteId } from '../animation/TemporarySpriteManifest'

export type StageId = 'laboratory' | 'company-building'
export const stageTextureKey = (id: StageId): string => `stage-${id}`

export const testStageManifest: Record<StageId, { id: StageId; label: string; url: string }> = {
  laboratory: { id: 'laboratory', label: 'LABORATORY', url: '/test-assets/stages/laboratory.png' },
  'company-building': { id: 'company-building', label: 'COMPANY BUILDING', url: '/test-assets/stages/company-building.png' },
}

export type SlotType = 'BODY_TEMPLATE' | 'FEATURED' | 'CUSTOM' | 'EMPTY'
export type SlotStatus = 'AVAILABLE' | 'PROCESSING' | 'READY' | 'FAILED'
export type CharacterEntry = { id: string; displayName: string; type: Exclude<SlotType, 'EMPTY'>; status: SlotStatus; spriteId?: SpriteId; heroTextureKey?: string; bodyTemplateId?: string }

export const testCharacterManifest = {
  presetA: { id: 'preset-a', displayName: 'ARIA', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'aria' },
  presetB: { id: 'preset-b', displayName: 'KAEL', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'kael' },
  presetC: { id: 'preset-c', displayName: 'RIVEN', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'riven' },
  presetD: { id: 'preset-d', displayName: 'KEVIN', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'kevin' },
  presetE: { id: 'preset-e', displayName: 'CUSTOM01', type: 'FEATURED', status: 'AVAILABLE', spriteId: 'body01' },
} as const satisfies Record<string, CharacterEntry>

// ponytail: Body 01 已有正式身形素材；其餘 spriteId 仍是戰鬥暫用替身（shared-ia §4.4）。P1 一律畫剪影。其餘 spriteId 取得正式身形素材後移除替身。
const bodySprites: readonly SpriteId[] = ['body01', 'kael', 'riven', 'aria']
export const bodyTemplates: readonly CharacterEntry[] = bodySprites.map((spriteId, i) => ({ id: `body-0${i + 1}`, displayName: `BODY 0${i + 1}`, type: 'BODY_TEMPLATE', status: 'AVAILABLE', spriteId, bodyTemplateId: `body-0${i + 1}` }))

export const characterEntries = (): CharacterEntry[] => [...bodyTemplates, ...Object.values(testCharacterManifest)]
export const characterEntry = (id: string | undefined): CharacterEntry | undefined => characterEntries().find((entry) => entry.id === id)

export const resolveStageAsset = (id: string | undefined): typeof testStageManifest[StageId] => testStageManifest[id as StageId] ?? testStageManifest.laboratory
