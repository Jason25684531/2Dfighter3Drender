export const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const uiTokens = {
  slant: 28,
  // label 是提示與說明的最小字級（展場觀看距離）；micro 只給 P1 角色格內的編號與名稱。
  type: { hero: 260, display: 120, h1: 72, h2: 40, title: 30, body: 24, label: 22, micro: 18 },
  fonts: { display: 'Oswald, Noto Sans TC, Arial, Microsoft JhengHei, sans-serif', body: 'Chivo, Noto Sans TC, Arial, Microsoft JhengHei, sans-serif', label: 'Space Grotesk, Noto Sans TC, Arial, Microsoft JhengHei, sans-serif', zh: 'Noto Sans TC, Microsoft JhengHei, sans-serif', graffiti: 'Sedgwick Ave Display, Oswald, Arial, sans-serif' },
  logicalWidth: 1920,
  logicalHeight: 1080,
  colors: {
    background0: 0x07080d,
    background1: 0x0e1220,
    panel: 0x0e1220,
    panelRaised: 0x171c2e,
    lineDim: 0x2a3249,
    playerPrimary: 0xe5172f,
    playerDeep: 0x840c20,
    playerGlow: 0xff5a6a,
    enemyPrimary: 0x7c3aed,
    enemyGlow: 0xb99bff,
    systemBlue: 0x2bbcff,
    lineBright: 0x4a5677,
    statusLime: 0xb6f23a,
    resultGold: 0xffc247,
    comboMagenta: 0xff3df0,
    textPrimary: 0xf5f7fb,
    textSecondary: 0xaeb8c9,
    focus: 0xffffff,
    selectBody: 0xffb51b,
    selectSaga: 0xe9edf4,
    selectGuest: 0xa6b7ce,
    selectRoster: 0x646672,
    selectBodyBackground: 0x211a11,
    selectSagaBackground: 0x1b1d24,
    selectGuestBackground: 0x142031,
    selectRosterBackground: 0x15151d,
    danger: 0xff2e44,
    shadow: 0x000000,
  },
  opacity: { panel: 0.94, overlay: 0.78, hintBar: 0.82, vignette: 0.42, inactive: 0.78 },
  backdrop: { empty: 0.56, content: 0.58, battle: 0.16, presentation: 0.22, result: 0.7, end: 0.64, impact: 0.5 },
  shadowBlur: { subtle: 18, focal: 24, impact: 34 },
  textStroke: { standard: 8, result: 10, badge: 5, announcer: 12, impact: 25 },
  focusScale: 1.06,
  stageFocusScale: 1.02,
  hud: { combo: 76 },
  // P1 雙玩家選角（design/shared-ia.md §2–§3、concept-a.md）
  p1: {
    hero: { height: 720, footY: 1000, x: { P1: 330, P2: 1590 } },
    cursor: { slideMs: reducedMotion ? 0 : 80 },
    processingMs: 2500,
    allReadyMs: 800,
    // ponytail: D-11 暫定值，待營運確認
    idleMs: { select: 60000, customize: 90000, attract: 60000 },
  },
  motionMs: { focus: reducedMotion ? 0 : 120, enter: reducedMotion ? 0 : 240, announcer: reducedMotion ? 0 : 360, focalReveal: reducedMotion ? 0 : 240 },
} as const

export type UiColorToken = keyof typeof uiTokens.colors

export const colorHex = (token: UiColorToken): string => `#${uiTokens.colors[token].toString(16).padStart(6, '0')}`
