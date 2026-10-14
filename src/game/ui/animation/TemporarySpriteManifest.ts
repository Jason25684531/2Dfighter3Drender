import type { FighterSnapshot } from '../../combat/CombatWorld'

export type SpriteId = 'aria' | 'kael' | 'riven'
export type SpriteAction = 'idle' | 'walk' | 'jump' | 'attack' | 'hurt' | 'guard'

const counts: Record<SpriteAction, number> = { idle: 4, walk: 6, jump: 4, attack: 6, hurt: 4, guard: 4 }
export const spriteIds: readonly SpriteId[] = ['aria', 'kael', 'riven']
export const spriteActions: readonly SpriteAction[] = ['idle', 'walk', 'jump', 'attack', 'hurt', 'guard']
export const spriteTextureKey = (id: SpriteId, action: SpriteAction, frame = 0): string => `${id}-${action}-${frame + 1}`
export const spriteFrameUrl = (id: SpriteId, action: SpriteAction, frame: number): string => `/test-assets/characters/${id}/${action}/${id}-${action}-${frame + 1}.png`
export const spriteFrameCount = (action: SpriteAction): number => counts[action]
// 256px 共用畫布；Kael／Riven 角色本體約佔滿畫布，縮小至與 Aria 相近的畫面高度。
export const spriteDisplayHeight = (id: SpriteId): number => id === 'aria' ? 700 : 520
// character-scale-profile.json 的 ground_reference_y_px／256。
export const spriteOriginY = (id: SpriteId): number => id === 'aria' ? 240 / 256 : 248 / 256

export const spriteActionFor = (fighter: FighterSnapshot): SpriteAction => {
  if (fighter.state === 'HIT_STUN') return 'hurt'
  if (fighter.attackPhase !== 'NONE') return 'attack'
  if (!fighter.grounded || fighter.state === 'JUMP') return 'jump'
  if (fighter.state === 'GUARD') return 'guard'
  if (fighter.state === 'WALK') return 'walk'
  return 'idle'
}

export const spriteFrameFor = (fighter: FighterSnapshot, action: SpriteAction, elapsedTicks: number): number => {
  if (action === 'attack') {
    if (fighter.attackPhase === 'STARTUP') return Math.min(1, Math.floor((fighter.attackTicks - 1) * 2 / 3))
    if (fighter.attackPhase === 'ACTIVE') return Math.min(3, 2 + fighter.attackTicks - 1)
    return Math.min(5, 4 + Math.floor((fighter.attackTicks - 1) * 2 / 5))
  }
  const frame = Math.floor(Math.max(0, elapsedTicks) / 2)
  return action === 'idle' || action === 'walk' || action === 'guard' ? frame % counts[action] : Math.min(counts[action] - 1, frame)
}
