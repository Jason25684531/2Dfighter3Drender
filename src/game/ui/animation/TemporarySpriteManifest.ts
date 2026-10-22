import type { FighterSnapshot } from '../../combat/CombatWorld'
import { isSheetSprite, SHEET_FRAME_COUNT } from './SheetSpriteManifest'
import type { AttackAction } from '../../input/ControlProfile'

export type SpriteId = 'aria' | 'kael' | 'riven' | 'kevin' | 'body01'
export type SpriteAction = 'idle' | 'walk' | 'jump' | 'attack' | 'hurt' | 'guard'

const counts: Record<SpriteAction, number> = { idle: 4, walk: 6, jump: 4, attack: 6, hurt: 4, guard: 4 }
export const spriteIds: readonly SpriteId[] = ['aria', 'kael', 'riven', 'kevin', 'body01']
export const spriteActions: readonly SpriteAction[] = ['idle', 'walk', 'jump', 'attack', 'hurt', 'guard']
// ponytail: sheet sprites have no hit-stun sheet; use the supplied prone reaction until dedicated art exists.
export const spriteTextureKey = (id: SpriteId, action: SpriteAction, frame = 0): string => isSheetSprite(id) ? `${id}-${action === 'hurt' ? 'prone' : action}` : `${id}-${action}-${frame + 1}`
export const spriteTextureFrame = (id: SpriteId | undefined, frame = 0): number | undefined => isSheetSprite(id) ? frame : undefined
export const spriteFrameUrl = (id: SpriteId, action: SpriteAction, frame: number): string => `/test-assets/characters/${id}/${action}/${id}-${action}-${frame + 1}.png`
export const spriteFrameCount = (action: SpriteAction): number => counts[action]
// 256px 共用畫布；Kael／Riven 角色本體約佔滿畫布，縮小至與 Aria 相近的畫面高度。
export const spriteDisplayHeight = (id: SpriteId): number => id === 'aria' ? 700 : isSheetSprite(id) ? 650 : 520
// character-scale-profile.json 的 ground_reference_y_px／256；body01 腳底同為 248/256。
export const spriteOriginY = (id: SpriteId): number => id === 'aria' ? 240 / 256 : id === 'kevin' ? 117 / 128 : 248 / 256

export const spriteActionFor = (fighter: FighterSnapshot): SpriteAction => {
  if (fighter.state === 'HIT_STUN') return 'hurt'
  if (fighter.attackPhase !== 'NONE') return 'attack'
  if (!fighter.grounded || fighter.state === 'JUMP') return 'jump'
  if (fighter.state === 'GUARD') return 'guard'
  if (fighter.state === 'WALK') return 'walk'
  return 'idle'
}

// 呈現語意 → sheet key（sheet 角色）。沒有獨立的重攻擊空中／蹲姿素材，不另外捏造。
export const presentationSheet = {
  IDLE: 'idle', MOVE: 'walk', JUMP: 'jump', CROUCH: 'crouch', BLOCK: 'guard',
  PUNCH_LIGHT: 'attack', PUNCH_HEAVY: 'punch-heavy', KICK_LIGHT: 'kick-light', KICK_HEAVY: 'kick-heavy',
  PUNCH_AIR: 'punch-jump', PUNCH_CROUCH: 'punch-crouch', KICK_AIR: 'kick-jump', KICK_CROUCH: 'kick-crouch',
  PRONE: 'prone', INTRO: 'intro-victory', VICTORY: 'intro-victory',
} as const
export type Presentation = keyof typeof presentationSheet
export type PresentationContext = { attack?: AttackAction; crouch?: boolean }
const standingAttack: Record<AttackAction, Presentation> = { LIGHT_PUNCH: 'PUNCH_LIGHT', HEAVY_PUNCH: 'PUNCH_HEAVY', LIGHT_KICK: 'KICK_LIGHT', HEAVY_KICK: 'KICK_HEAVY' }
/** Combat 決定狀態，這裡只決定播哪張圖；不讀寫 Combat。蹲姿是純呈現（Combat 沒有蹲）。 */
export const resolvePresentation = (fighter: FighterSnapshot, { attack = 'LIGHT_PUNCH', crouch = false }: PresentationContext = {}): Presentation => {
  if (fighter.state === 'HIT_STUN') return 'PRONE'
  if (fighter.attackPhase !== 'NONE') {
    const kick = attack.endsWith('KICK')
    return !fighter.grounded ? kick ? 'KICK_AIR' : 'PUNCH_AIR' : crouch ? kick ? 'KICK_CROUCH' : 'PUNCH_CROUCH' : standingAttack[attack]
  }
  if (!fighter.grounded || fighter.state === 'JUMP') return 'JUMP'
  if (fighter.state === 'GUARD') return 'BLOCK'
  if (fighter.state === 'WALK') return 'MOVE'
  return crouch ? 'CROUCH' : 'IDLE'
}

export const spriteFrameFor = (fighter: FighterSnapshot, action: SpriteAction, elapsedTicks: number, id?: SpriteId): number => {
  if (isSheetSprite(id)) {
    if (action === 'attack') {
      if (fighter.attackPhase === 'STARTUP') return Math.min(5, Math.max(0, (fighter.attackTicks - 1) * 2))
      if (fighter.attackPhase === 'ACTIVE') return Math.min(9, 6 + Math.max(0, fighter.attackTicks - 1) * 2)
      return Math.min(15, 10 + Math.floor(Math.max(0, fighter.attackTicks - 1) * 5 / 4))
    }
    const frame = Math.floor(Math.max(0, elapsedTicks) / 5)
    return action === 'idle' || action === 'walk' || action === 'guard' ? frame % SHEET_FRAME_COUNT : Math.min(SHEET_FRAME_COUNT - 1, frame)
  }
  if (action === 'attack') {
    if (fighter.attackPhase === 'STARTUP') return Math.min(1, Math.floor((fighter.attackTicks - 1) * 2 / 3))
    if (fighter.attackPhase === 'ACTIVE') return Math.min(3, 2 + fighter.attackTicks - 1)
    return Math.min(5, 4 + Math.floor((fighter.attackTicks - 1) * 2 / 5))
  }
  const frame = Math.floor(Math.max(0, elapsedTicks) / 2)
  return action === 'idle' || action === 'walk' || action === 'guard' ? frame % counts[action] : Math.min(counts[action] - 1, frame)
}
