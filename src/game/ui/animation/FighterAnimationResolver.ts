import type { Facing, FighterSnapshot, CombatEvent } from '../../combat/CombatWorld'
import type { FighterAnimationEntry, FighterAnimationKey } from './FighterAnimationManifest'

export type FighterVisualInput = Pick<FighterSnapshot, 'vx' | 'vy' | 'grounded' | 'facing' | 'state' | 'attackPhase' | 'attackId'> & { recentEvent?: CombatEvent; recentEventToken?: string }
export type FighterAnimationResolution = { animationKey: FighterAnimationKey; loop: boolean; facing: Facing; restartToken?: string }

export const facingScaleX = (facing: Facing): 1 | -1 => facing === 'LEFT' ? -1 : 1

export const resolvePreviewAnimation = (animationKey: FighterAnimationKey, entry: FighterAnimationEntry | undefined, facing: Facing, loopOverride?: boolean): FighterAnimationResolution => ({ animationKey, loop: loopOverride ?? entry?.loop ?? false, facing, restartToken: `preview:${animationKey}:${loopOverride ?? 'manifest'}` })

const relativeMovement = (vx: number, facing: Facing): 'FORWARD' | 'BACKWARD' | 'NONE' => {
  if (vx === 0) return 'NONE'
  const forward = facing === 'RIGHT' ? vx > 0 : vx < 0
  return forward ? 'FORWARD' : 'BACKWARD'
}

export const resolveFighterAnimation = (input: FighterVisualInput, manifest: Record<FighterAnimationKey, FighterAnimationEntry>): FighterAnimationResolution => {
  const event = input.recentEvent
  if (input.state === 'HIT_STUN') return { animationKey: 'HIT_STUN', loop: false, facing: input.facing, restartToken: input.recentEventToken }
  if (event?.type === 'BLOCK' && event.defender === 'PLAYER') return { animationKey: 'BLOCK_STUN', loop: false, facing: input.facing, restartToken: `${event.attackId}:${input.recentEventToken ?? ''}` }
  if (input.attackPhase !== 'NONE') return { animationKey: 'STANDING_LIGHT_PUNCH', loop: false, facing: input.facing, restartToken: `attack:${input.attackId}` }
  if (!input.grounded || input.state === 'JUMP' || input.vy !== 0) return { animationKey: 'JUMP', loop: false, facing: input.facing }
  const movement = relativeMovement(input.vx, input.facing)
  if (movement === 'FORWARD') return { animationKey: 'WALK_FORWARD', loop: true, facing: input.facing }
  if (movement === 'BACKWARD' || input.state === 'GUARD') return { animationKey: 'WALK_BACKWARD', loop: true, facing: input.facing }
  const key: FighterAnimationKey = 'IDLE'
  return { animationKey: manifest[key] ? key : 'WALK_BACKWARD', loop: true, facing: input.facing }
}
