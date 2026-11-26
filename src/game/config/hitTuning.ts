import type { AttackAction } from '../input/ControlProfile'
import type { SpriteId } from '../ui/animation/TemporarySpriteManifest'

type Reach = Partial<Record<AttackAction, number>>
type Lunge = Partial<Record<AttackAction, { advance: number; hop: number }>>
const bodyReach = { LIGHT_PUNCH: 40, HEAVY_PUNCH: 40, LIGHT_KICK: 40, HEAVY_KICK: 40 }
const heavyLunge = { advance: 140, hop: 60 }
const bothLunges = { LIGHT_PUNCH: { advance: 90, hop: 40 }, HEAVY_PUNCH: heavyLunge }
// 客製角色（HW／HSI／JF／Grace／AK／Jeansen）：輕拳只比待機輪廓多伸出 0–60（長官約 130–230）。輕拳補外推並滑步、重拳前衝；
// scripts/verify-punch-reach.mjs 實測最遠命中距離：輕拳 310–400 → 400–480（長官 410–490），重拳 240–410 → 370–560（Tony／YG 550–560）。
const customReach = { LIGHT_PUNCH: 50 }
const customLunge = { LIGHT_PUNCH: { advance: 60, hop: 0 }, HEAVY_PUNCH: heavyLunge }

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
    // Body 01 放大 1.25 倍、身體寬，走到貼身已相距 341，輕拳原本只多 80 射程（GO 約 220）。
    s1aw: { ...bodyReach, ...customReach },
    // Body 02（含模板 02 生成的玩家）與 HW／JF 同一套短刺拳美術：輕拳一樣補到 50；重拳改靠前衝，不再額外外推（實測 400／450 → 460／540）。
    s2am: { ...bodyReach, ...customReach, HEAVY_PUNCH: 0 },
    s2lw: bodyReach,
    // Body 04：站定直拳，重拳原本 170 ≈ 貼身距離 167，幾乎打不到。
    s3ww: customReach,
    hw: customReach, hsi: customReach, jf: customReach, grace: customReach, ak: customReach, jeansen: customReach,
  } as Partial<Record<SpriteId | 'default', Reach>>,
  /** 地面站姿拳招的前進距離與顯示高度，使用戰鬥座標。 */
  lunge: {
    go: bothLunges,
    joneey: bothLunges,
    yg: { HEAVY_PUNCH: heavyLunge },
    tony: { HEAVY_PUNCH: heavyLunge },
    // Body 03：重拳原本是站定直拳，加上前衝＋跳起。
    s2lw: { HEAVY_PUNCH: heavyLunge },
    s1aw: { LIGHT_PUNCH: customLunge.LIGHT_PUNCH },
    s3ww: customLunge,
    s2am: customLunge,
    hw: customLunge, hsi: customLunge, jf: customLunge, grace: customLunge, ak: customLunge, jeansen: customLunge,
  } as Partial<Record<SpriteId, Lunge>>,
  /** 攻擊力倍率：該角色每一招的傷害 × 倍率（四捨五入）；沒列的角色＝1。基礎傷害：輕拳 6、重拳 12、輕踢 8、重踢 14，血量 100。 */
  power: {
    // 隱藏角色：輕拳 6→18、重拳 12→36、輕踢 8→24、重踢 14→42。
    jeansen: 3,
  } as Partial<Record<SpriteId, number>>,
}

// 生成角色 ID＝generated-<名稱>_<模板名>；ComfyUI 模板 2（S2AM）沿用 Body 02、模板 3（S1AM）沿用跳過拍照 Body 03 的 S2LW 調整值。
const baseSprite = (sprite?: SpriteId): SpriteId | undefined => sprite?.replace(/^hd-/, '').replace(/^generated-.*_S2AM$/, 's2am').replace(/^generated-.*_S1AM$/, 's2lw') as SpriteId | undefined

export const reachFor = (sprite: SpriteId | undefined, attack: AttackAction): number => {
  const id = baseSprite(sprite)
  return (id && HIT_TUNING.reach[id]?.[attack]) ?? HIT_TUNING.reach.default?.[attack] ?? 0
}

export const lungeFor = (sprite?: SpriteId): Lunge | undefined => {
  const id = baseSprite(sprite)
  return id ? HIT_TUNING.lunge[id] : undefined
}

export const powerFor = (sprite?: SpriteId): number => {
  const id = baseSprite(sprite)
  return (id && HIT_TUNING.power[id]) || 1
}
