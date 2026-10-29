import { AppState, type AppState as AppStateValue } from './AppState'

export const appStateTransitions: Readonly<Record<AppStateValue, readonly AppStateValue[]>> = {
  [AppState.IDLE]: [AppState.READY],
  [AppState.READY]: [AppState.SETUP, AppState.IDLE],
  [AppState.SETUP]: [AppState.LOADING, AppState.READY],
  [AppState.LOADING]: [AppState.BATTLE, AppState.IDLE],
  [AppState.BATTLE]: [AppState.PRESENTATION, AppState.IDLE],
  [AppState.PRESENTATION]: [AppState.RESULT, AppState.IDLE],
  [AppState.RESULT]: [AppState.END, AppState.IDLE],
  [AppState.END]: [AppState.SETUP, AppState.IDLE],
}

export const backRoutes: Partial<Record<AppStateValue, AppStateValue>> = {
  [AppState.READY]: AppState.IDLE,
  [AppState.SETUP]: AppState.READY,
  // P3／P5／P6 按 ESC 回主畫面（結束 session）。
  [AppState.LOADING]: AppState.IDLE,
  [AppState.PRESENTATION]: AppState.IDLE,
  [AppState.RESULT]: AppState.IDLE,
}
