/**
 * 舞台與鏡頭的調整參數；只改這個檔案即可。
 * 單位：world = 戰鬥座標；畫面像素 = world × worldZoom（1920×1080 邏輯畫面）。
 */
export const STAGE_TUNING = {
  /** 戰鬥呈現縮放。可視寬度 = 1920 / worldZoom（0.9 → 2133 world）。 */
  worldZoom: 0.9,
  /**
   * 背景每邊可移動的畫面像素。實驗室影片顯示 2880 寬 − 螢幕 1920 = 960 → 每邊 480。
   * 場地寬度與鏡頭上限由此反推：鏡頭上限 = backgroundTravel / parallax.background。
   */
  backgroundTravel: 480,
  /** 各層相對鏡頭的移動速度（畫面像素 / world）。0.9 = 與角色同速（影片含地板，角色會「踩在」地上）。 */
  parallax: { background: 0.9, middle: 0.6, foreground: 1.0 },
  /** 兩人中心最小距離（world）。sprite 身體約 285 寬；調大需同時加長攻擊 hitboxOffset。 */
  pushWidth: 220,
  /** 角色中心離場地左右牆的最小距離（world）；約 sprite 半身寬，避免在場地邊緣被畫面切掉一半。 */
  wallMargin: 150,
  /** 兩人最大距離（world），須小於可視寬度減去角色寬，才能保證兩人同時在畫面內。 */
  maxSeparation: 1800,
} as const

const { worldZoom, backgroundTravel, parallax } = STAGE_TUNING
/** 鏡頭中心相對場地中央的最大位移（world）。預設 480 / 0.9 ≈ 533。 */
export const MAX_SCROLL = backgroundTravel / parallax.background
/** 場地寬（world）= 可視寬 + 兩側鏡頭行程。預設 2133 + 1067 = 3200。 */
export const ARENA_WIDTH = 2 * (960 / worldZoom + MAX_SCROLL)
