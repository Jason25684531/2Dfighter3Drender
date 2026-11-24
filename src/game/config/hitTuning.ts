import type { AttackAction } from '../input/ControlProfile'
import type { SpriteId } from '../ui/animation/TemporarySpriteManifest'

type Reach = Partial<Record<AttackAction, number>>

/**
 * 命中距離的調整參數；只改這個檔案即可。
 * 單位：world = 戰鬥座標；畫面像素 ≈ world × 0.9。
 * 命中 = 攻擊者拳腳的不透明像素，落在「防守者輪廓往外 edge + reach」以內。
 */
export const HIT_TUNING = {
  /** 每招的基礎 Alpha 外推距離。站、蹲、跳共用對應招式的設定。 */
  edge: {
    LIGHT_PUNCH: 10,
    HEAVY_PUNCH: 10,
    LIGHT_KICK: 7.5,
    HEAVY_KICK: 7.5,
  } satisfies Record<AttackAction, number>,
  /** 推擠：兩人輪廓最近停在相距多少；須 ≤ edge，貼身時出招才必中。 */
  pushEdge: 5,
  /**
   * 額外的命中距離：角色 × 招式。查找順序：該角色那一格 → default 那一格 → 0。
   * 輕攻擊（LIGHT_PUNCH／LIGHT_KICK，含蹲姿、空中版本）手腳畫得短，所以預設就加。
   * 建議 ≤ 50，太大會看起來隔空命中。DEV 可加 ?hitbox 對照。
   */
  reach: {
    default: { LIGHT_PUNCH: 30, LIGHT_KICK: 30 },
    s1aw: { LIGHT_PUNCH: 40, HEAVY_PUNCH: 40, LIGHT_KICK: 40, HEAVY_KICK: 40 },
    s2am: { LIGHT_PUNCH: 40, HEAVY_PUNCH: 40, LIGHT_KICK: 40, HEAVY_KICK: 40 },
    s2lw: { LIGHT_PUNCH: 40, HEAVY_PUNCH: 40, LIGHT_KICK: 40, HEAVY_KICK: 40 },
  } as Partial<Record<SpriteId | 'default', Reach>>,
}

export const reachFor = (sprite: SpriteId | undefined, attack: AttackAction): number => {
  const id = sprite?.replace(/^hd-/, '') as SpriteId | undefined
  return (id && HIT_TUNING.reach[id]?.[attack]) ?? HIT_TUNING.reach.default?.[attack] ?? 0
}
