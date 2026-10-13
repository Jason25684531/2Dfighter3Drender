export type FighterAnimationKey =
  | 'IDLE' | 'WALK_FORWARD' | 'WALK_BACKWARD' | 'JUMP' | 'CROUCH'
  | 'STANDING_LIGHT_PUNCH' | 'STANDING_HEAVY_PUNCH' | 'STANDING_LIGHT_KICK' | 'STANDING_HEAVY_KICK'
  | 'JUMP_LIGHT_PUNCH' | 'JUMP_HEAVY_PUNCH' | 'JUMP_LIGHT_KICK' | 'JUMP_HEAVY_KICK'
  | 'CROUCH_LIGHT_PUNCH' | 'CROUCH_HEAVY_PUNCH' | 'CROUCH_LIGHT_KICK' | 'CROUCH_HEAVY_KICK'
  | 'HIT_STUN' | 'BLOCK_STUN'

export type FighterAnimationEntry = { key: FighterAnimationKey; filename: string; url?: string; loop: boolean; fallbackKey?: FighterAnimationKey; previewOnly: boolean; scale: number; offsetX: number; offsetY: number; nominalDurationMs?: number }

const file = (key: FighterAnimationKey, filename: string, options: Partial<FighterAnimationEntry> = {}): FighterAnimationEntry => ({ key, filename, url: `/test-assets/characters/sample-fighter/${filename}`, loop: true, previewOnly: false, scale: 1, offsetX: 0, offsetY: 0, ...options })

export const sampleCharacterAnimationManifest: Record<FighterAnimationKey, FighterAnimationEntry> = {
  IDLE: file('IDLE', 'idle.webm', { nominalDurationMs: 2334 }),
  WALK_FORWARD: file('WALK_FORWARD', 'walkF.webm', { nominalDurationMs: 1250 }),
  WALK_BACKWARD: file('WALK_BACKWARD', 'walkB.webm', { nominalDurationMs: 2250 }),
  JUMP: file('JUMP', 'jump.webm', { loop: false, nominalDurationMs: 750 }),
  CROUCH: file('CROUCH', 'crouch.webm', { previewOnly: true, nominalDurationMs: 750 }),
  STANDING_LIGHT_PUNCH: file('STANDING_LIGHT_PUNCH', 'stA.webm', { loop: false, nominalDurationMs: 250 }),
  STANDING_HEAVY_PUNCH: file('STANDING_HEAVY_PUNCH', 'stB.webm', { loop: false, previewOnly: true, nominalDurationMs: 317 }),
  STANDING_LIGHT_KICK: file('STANDING_LIGHT_KICK', 'stC.webm', { loop: false, previewOnly: true, nominalDurationMs: 567 }),
  STANDING_HEAVY_KICK: file('STANDING_HEAVY_KICK', 'stD.webm', { loop: false, previewOnly: true, nominalDurationMs: 484 }),
  JUMP_LIGHT_PUNCH: file('JUMP_LIGHT_PUNCH', 'jA.webm', { loop: false, previewOnly: true, nominalDurationMs: 234 }),
  JUMP_HEAVY_PUNCH: file('JUMP_HEAVY_PUNCH', 'jB.webm', { loop: false, previewOnly: true, nominalDurationMs: 267 }),
  JUMP_LIGHT_KICK: file('JUMP_LIGHT_KICK', 'jC.webm', { loop: false, previewOnly: true, nominalDurationMs: 267 }),
  JUMP_HEAVY_KICK: file('JUMP_HEAVY_KICK', 'jD.webm', { loop: false, previewOnly: true, nominalDurationMs: 217 }),
  CROUCH_LIGHT_PUNCH: file('CROUCH_LIGHT_PUNCH', 'crA.webm', { loop: false, previewOnly: true, nominalDurationMs: 234 }),
  CROUCH_HEAVY_PUNCH: file('CROUCH_HEAVY_PUNCH', 'crB.webm', { loop: false, previewOnly: true, nominalDurationMs: 267 }),
  CROUCH_LIGHT_KICK: file('CROUCH_LIGHT_KICK', 'crC.webm', { loop: false, previewOnly: true, nominalDurationMs: 567 }),
  CROUCH_HEAVY_KICK: file('CROUCH_HEAVY_KICK', 'crD.webm', { loop: false, previewOnly: true, nominalDurationMs: 550 }),
  HIT_STUN: file('HIT_STUN', 'hitstun.webm', { loop: false, nominalDurationMs: 417 }),
  BLOCK_STUN: file('BLOCK_STUN', 'blockstun.webm', { loop: false, fallbackKey: 'WALK_BACKWARD', nominalDurationMs: 167 }),
}

export const existingAnimationEntries = (): FighterAnimationEntry[] => Object.values(sampleCharacterAnimationManifest).filter((entry) => Boolean(entry.url))

export const animationCategories: ReadonlyArray<{ label: string; keys: readonly FighterAnimationKey[] }> = [
  { label: 'BASIC', keys: ['IDLE', 'WALK_FORWARD', 'WALK_BACKWARD', 'JUMP', 'CROUCH'] },
  { label: 'STANDING', keys: ['STANDING_LIGHT_PUNCH', 'STANDING_HEAVY_PUNCH', 'STANDING_LIGHT_KICK', 'STANDING_HEAVY_KICK'] },
  { label: 'AIR', keys: ['JUMP_LIGHT_PUNCH', 'JUMP_HEAVY_PUNCH', 'JUMP_LIGHT_KICK', 'JUMP_HEAVY_KICK'] },
  { label: 'CROUCH', keys: ['CROUCH_LIGHT_PUNCH', 'CROUCH_HEAVY_PUNCH', 'CROUCH_LIGHT_KICK', 'CROUCH_HEAVY_KICK'] },
  { label: 'REACTION', keys: ['HIT_STUN', 'BLOCK_STUN'] },
]
