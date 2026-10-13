import type { FighterSnapshot } from '../../combat/CombatWorld'

export type SpriteId = 'aria' | 'kael' | 'riven'
export type SpriteAction = 'idle' | 'walk' | 'jump' | 'attack' | 'hurt'

const counts: Record<SpriteAction, number> = { idle: 4, walk: 6, jump: 4, attack: 6, hurt: 4 }
export const spriteIds: readonly SpriteId[] = ['aria', 'kael', 'riven']
export const spriteActions: readonly SpriteAction[] = ['idle', 'walk', 'jump', 'attack', 'hurt']
export const spriteTextureKey = (id: SpriteId, action: SpriteAction, frame = 0): string => `${id}-${action}-${frame + 1}`
export const spriteFrameUrl = (id: SpriteId, action: SpriteAction, frame: number): string => `/test-assets/characters/${id}/${action}/${id === 'riven' ? `${action}-${String(frame + 1).padStart(2, '0')}` : `${id}-${action}-${frame + 1}`}.png`
export const spriteFrameCount = (action: SpriteAction): number => counts[action]
export const spriteDisplayHeight = (id: SpriteId): number => id === 'riven' ? 500 : 700
export const spriteOriginY = (id: SpriteId): number => id === 'riven' ? 0.95 : 0.9

export const spriteActionFor = (fighter: FighterSnapshot): SpriteAction => {
  if (fighter.state === 'HIT_STUN') return 'hurt'
  if (fighter.attackPhase !== 'NONE') return 'attack'
  if (!fighter.grounded || fighter.state === 'JUMP') return 'jump'
  if (fighter.state === 'WALK' || fighter.state === 'GUARD') return 'walk'
  return 'idle'
}

export const spriteFrameFor = (fighter: FighterSnapshot, action: SpriteAction, elapsedTicks: number): number => {
  if (action === 'attack') {
    if (fighter.attackPhase === 'STARTUP') return Math.min(1, Math.floor((fighter.attackTicks - 1) * 2 / 3))
    if (fighter.attackPhase === 'ACTIVE') return Math.min(3, 2 + fighter.attackTicks - 1)
    return Math.min(5, 4 + Math.floor((fighter.attackTicks - 1) * 2 / 5))
  }
  const frame = Math.floor(Math.max(0, elapsedTicks) / 2)
  return action === 'idle' || action === 'walk' ? frame % counts[action] : Math.min(counts[action] - 1, frame)
}
