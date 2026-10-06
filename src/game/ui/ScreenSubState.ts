import { AppState, type AppState as Screen } from '../state/AppState'
import type { UIEventBus } from './UIEventBus'

const states = {
  [AppState.IDLE]: ['EMPTY', 'RECORDS_1_TO_4', 'RECORDS_5_PLUS'],
  [AppState.READY]: ['READY', 'PROCESSING', 'FALLBACK'],
  [AppState.SETUP]: ['DEFAULT'], [AppState.LOADING]: ['DEFAULT'],
  [AppState.BATTLE]: ['NORMAL', 'COMBO', 'DANGER', 'LAST_10_SECONDS'],
  [AppState.PRESENTATION]: ['DEFAULT'],
  [AppState.RESULT]: ['RANK_1_TO_6', 'RANK_7_TO_19', 'RANK_20', 'NOT_RANKED'],
  [AppState.END]: ['DEFAULT'],
} as const
type SubState = (typeof states)[Screen][number]
const defaults: Record<Screen, SubState> = {
  [AppState.IDLE]: 'EMPTY', [AppState.READY]: 'READY', [AppState.SETUP]: 'DEFAULT', [AppState.LOADING]: 'DEFAULT',
  [AppState.BATTLE]: 'NORMAL', [AppState.PRESENTATION]: 'DEFAULT', [AppState.RESULT]: 'NOT_RANKED', [AppState.END]: 'DEFAULT',
}

export class ScreenSubState {
  private readonly current = { ...defaults }
  constructor(private readonly events: UIEventBus) {}
  get<S extends Screen>(screen: S): (typeof states)[S][number] { return this.current[screen] as (typeof states)[S][number] }
  set(screen: Screen, next: string): boolean {
    if (!(states[screen] as readonly string[]).includes(next) || this.current[screen] === next) return false
    const previous = this.current[screen]; this.current[screen] = next as SubState
    this.events.emit('SUBSTATE_CHANGED', { screen, previous, next }); return true
  }
  reset(screen: Screen): boolean { return this.set(screen, defaults[screen]) }
}
