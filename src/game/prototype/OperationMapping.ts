import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'
import { loadProfiles, menuKeys, type Bindings } from '../input/ControlProfile'

// 讀已儲存的鍵位（與正式 CONTROLS 面板同一份）；重新整理頁面後生效。
export const combatMapping = loadProfiles()
const ownerKeys = { P1: menuKeys(combatMapping.P1, 'P1'), P2: menuKeys(combatMapping.P2, 'P2') }
export const menuMapping = Object.fromEntries((['P1', 'P2'] as PlayerSlotId[]).map(owner => [owner, Object.fromEntries(Object.entries(ownerKeys[owner]).flatMap(([action, codes]) => codes.map(code => [code, action as OwnedUiAction])))])) as Record<PlayerSlotId, Record<string, OwnedUiAction>>
import { presentationSheet as semanticAnimation, type Presentation as Semantic } from '../ui/animation/TemporarySpriteManifest'
export { semanticAnimation, type Semantic }
/** 僅供展示；正式 Combat snapshot 才能決定戰鬥呈現。 */
export function resolveDemo(held: ReadonlySet<string>, facing: 'LEFT' | 'RIGHT', keys: Bindings): Semantic {
  const down = (key: keyof Bindings) => held.has(keys[key])
  const punch = down('LIGHT_PUNCH') || down('HEAVY_PUNCH'), kick = down('LIGHT_KICK') || down('HEAVY_KICK')
  if (punch || kick) {
    if (down('JUMP')) return punch ? 'PUNCH_AIR' : 'KICK_AIR'
    if (down('CROUCH')) return punch ? 'PUNCH_CROUCH' : 'KICK_CROUCH'
    return punch ? down('HEAVY_PUNCH') ? 'PUNCH_HEAVY' : 'PUNCH_LIGHT' : down('HEAVY_KICK') ? 'KICK_HEAVY' : 'KICK_LIGHT'
  }
  // 按住下＝防禦，與戰鬥一致（地面防禦優先於跳）；BLOCK 與 CROUCH 都用蹲姿圖。
  if (down('CROUCH')) return 'BLOCK'
  if (down('JUMP')) return 'JUMP'
  const direction = Number(down('MOVE_RIGHT')) - Number(down('MOVE_LEFT'))
  if (direction === (facing === 'RIGHT' ? -1 : 1)) return 'BLOCK'
  return direction ? 'MOVE' : 'IDLE'
}
