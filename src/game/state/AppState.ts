export const AppState = {
  IDLE: 'P0_IDLE',
  READY: 'P1_READY',
  SETUP: 'P2_SETUP',
  LOADING: 'P3_LOADING',
  BATTLE: 'P4_BATTLE',
  PRESENTATION: 'P5_PRESENTATION',
  RESULT: 'P6_RESULT',
  END: 'P7_END',
} as const

export type AppState = (typeof AppState)[keyof typeof AppState]
