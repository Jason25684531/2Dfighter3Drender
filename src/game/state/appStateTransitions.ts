import { AppState, type AppState as AppStateValue } from './AppState'

export const appStateTransitions: Readonly<Record<AppStateValue, readonly AppStateValue[]>> = {
  [AppState.IDLE]: [AppState.READY],
  [AppState.READY]: [AppState.SETUP, AppState.IDLE],
  [AppState.SETUP]: [AppState.LOADING, AppState.READY],
  [AppState.LOADING]: [AppState.BATTLE],
  [AppState.BATTLE]: [AppState.PRESENTATION, AppState.IDLE],
  [AppState.PRESENTATION]: [AppState.RESULT],
  [AppState.RESULT]: [AppState.END],
  [AppState.END]: [AppState.SETUP, AppState.IDLE],
}

export const backRoutes: Partial<Record<AppStateValue, AppStateValue>> = {
  [AppState.READY]: AppState.IDLE,
  [AppState.SETUP]: AppState.READY,
}
