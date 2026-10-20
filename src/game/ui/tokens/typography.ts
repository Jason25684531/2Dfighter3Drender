import { colorHex, uiTokens } from './uiTokens'

const { type, fonts } = uiTokens
const display = { fontFamily: fonts.display, color: colorHex('textPrimary'), fontStyle: 'bold' }
export const typography = {
  family: fonts.body,
  heading: { ...display, fontSize: type.h1, letterSpacing: 2 },
  title: { ...display, fontSize: type.h1 },
  action: { ...display, fontSize: type.h2, letterSpacing: 1 },
  secondaryAction: { ...display, fontSize: type.title },
  instruction: { fontFamily: fonts.body, fontSize: type.body, color: colorHex('textPrimary') },
  note: { fontFamily: fonts.label, fontSize: type.label, color: colorHex('textSecondary') },
  number: { ...display, fontSize: type.h2 },
  timer: { ...display, fontSize: type.h1 },
  combo: { ...display, fontSize: type.h2, color: colorHex('statusLime') },
  nickname: { fontFamily: fonts.body, fontSize: type.title, color: colorHex('textPrimary') },
  danger: { ...display, fontSize: type.title, color: colorHex('danger') },
  announcer: { ...display, fontSize: type.display, stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.announcer },
} as const
