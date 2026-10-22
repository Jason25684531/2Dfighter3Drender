import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'

export const menuMapping: Record<PlayerSlotId, Record<string, OwnedUiAction>> = {
  P1: { KeyW: 'NAV_UP', KeyS: 'NAV_DOWN', KeyA: 'NAV_LEFT', KeyD: 'NAV_RIGHT', KeyJ: 'CONFIRM', KeyK: 'BACK' },
  P2: { ArrowUp: 'NAV_UP', ArrowDown: 'NAV_DOWN', ArrowLeft: 'NAV_LEFT', ArrowRight: 'NAV_RIGHT', Enter: 'CONFIRM', Backspace: 'BACK' },
}
export type CombatBinding = Record<'left' | 'right' | 'jump' | 'crouch' | 'lightPunch' | 'heavyPunch' | 'lightKick' | 'heavyKick', string>
export const combatMapping: Record<PlayerSlotId, CombatBinding> = {
  P1: { left: 'KeyA', right: 'KeyD', jump: 'KeyW', crouch: 'KeyS', lightPunch: 'KeyF', heavyPunch: 'KeyU', lightKick: 'KeyG', heavyKick: 'KeyI' },
  P2: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', crouch: 'ArrowDown', lightPunch: 'Numpad1', heavyPunch: 'Numpad2', lightKick: 'Numpad4', heavyKick: 'Numpad5' },
}
import { presentationSheet as semanticAnimation, type Presentation as Semantic } from '../ui/animation/TemporarySpriteManifest'
export { semanticAnimation, type Semantic }
/** 僅供展示；正式 Combat snapshot 才能決定戰鬥呈現。 */
export function resolveDemo(held: ReadonlySet<string>, facing: 'LEFT' | 'RIGHT', keys: CombatBinding): Semantic {
  const down = (key: keyof CombatBinding) => held.has(keys[key])
  const punch = down('lightPunch') || down('heavyPunch'), kick = down('lightKick') || down('heavyKick')
  if (punch || kick) {
    if (down('jump')) return punch ? 'PUNCH_AIR' : 'KICK_AIR'
    if (down('crouch')) return punch ? 'PUNCH_CROUCH' : 'KICK_CROUCH'
    return punch ? down('heavyPunch') ? 'PUNCH_HEAVY' : 'PUNCH_LIGHT' : down('heavyKick') ? 'KICK_HEAVY' : 'KICK_LIGHT'
  }
  if (down('jump')) return 'JUMP'
  if (down('crouch')) return 'CROUCH'
  const direction = Number(down('right')) - Number(down('left'))
  if (direction === (facing === 'RIGHT' ? -1 : 1)) return 'BLOCK'
  return direction ? 'MOVE' : 'IDLE'
}
