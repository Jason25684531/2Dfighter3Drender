export type StageId = 'laboratory' | 'company-building'
export const stageTextureKey = (id: StageId): string => `stage-${id}`

export const testStageManifest: Record<StageId, { id: StageId; label: string; url: string }> = {
  laboratory: { id: 'laboratory', label: 'LABORATORY', url: '/test-assets/stages/laboratory.png' },
  'company-building': { id: 'company-building', label: 'COMPANY BUILDING', url: '/test-assets/stages/company-building.png' },
}

export const testUiAssetManifest = {
  storyboard: { id: 'storyboard', url: '/test-assets/ui/uiux-sample.png', opaqueReferenceOnly: true },
} as const

export const testCharacterManifest = {
  presetA: { id: 'preset-a', nickname: 'ROG_Player', spriteId: 'aria', previewUrl: '/test-assets/characters/sample-fighter/idle.webm' },
  presetB: { id: 'preset-b', nickname: 'Shadow', spriteId: 'kael', previewUrl: '' },
  presetC: { id: 'preset-c', nickname: 'Nancy', spriteId: 'riven', previewUrl: '' },
  custom: { id: 'custom', nickname: 'CUSTOM', spriteId: undefined, previewUrl: '' },
} as const

export const resolveStageAsset = (id: string | undefined): typeof testStageManifest[StageId] => testStageManifest[id as StageId] ?? testStageManifest.laboratory
