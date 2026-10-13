import { colorHex, uiTokens } from './uiTokens'

export const typography = {
  family: 'Arial, Microsoft JhengHei, sans-serif',
  heading: { fontFamily: 'Arial Black, Arial, Microsoft JhengHei, sans-serif', fontSize: '52px', color: colorHex('textPrimary'), fontStyle: 'bold', letterSpacing: 2 },
  title: { fontFamily: 'Arial Black, Arial, Microsoft JhengHei, sans-serif', fontSize: '76px', color: colorHex('textPrimary'), fontStyle: 'bold', letterSpacing: 1 },
  action: { fontFamily: 'Arial Black, Arial, Microsoft JhengHei, sans-serif', fontSize: '42px', color: colorHex('textPrimary'), fontStyle: 'bold', letterSpacing: 1 },
  secondaryAction: { fontFamily: 'Arial Black, Arial, Microsoft JhengHei, sans-serif', fontSize: '34px', color: colorHex('textPrimary'), fontStyle: 'bold', letterSpacing: 1 },
  instruction: { fontFamily: 'Arial, Microsoft JhengHei, sans-serif', fontSize: '28px', color: colorHex('textPrimary') },
  note: { fontFamily: 'Arial, Microsoft JhengHei, sans-serif', fontSize: '24px', color: colorHex('textSecondary') },
  number: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '48px', color: colorHex('textPrimary'), fontStyle: 'bold' },
  timer: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: `${uiTokens.hud.timer}px`, color: colorHex('textPrimary'), fontStyle: 'bold' },
  combo: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: `${uiTokens.hud.combo}px`, color: colorHex('statusLime'), fontStyle: 'bold' },
  nickname: { fontFamily: 'Arial Black, Arial, Microsoft JhengHei, sans-serif', fontSize: `${uiTokens.hud.nickname}px`, color: colorHex('textPrimary'), fontStyle: 'bold' },
  danger: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: `${uiTokens.hud.danger}px`, color: colorHex('danger'), fontStyle: 'bold' },
  announcer: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '180px', color: colorHex('textPrimary'), fontStyle: 'bold', stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.announcer },
} as const
