import { AppState, type AppState as AppStateValue } from './AppState'

export const appStateTransitions: Readonly<Record<AppStateValue, readonly AppStateValue[]>> = {
  [AppState.IDLE]: [AppState.READY],
  [AppState.READY]: [AppState.SETUP],
  [AppState.SETUP]: [AppState.LOADING],
  [AppState.LOADING]: [AppState.BATTLE],
  [AppState.BATTLE]: [AppState.PRESENTATION],
  [AppState.PRESENTATION]: [AppState.RESULT],
  [AppState.RESULT]: [AppState.END],
  [AppState.END]: [AppState.SETUP, AppState.IDLE],
}
