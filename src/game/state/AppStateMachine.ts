import { AppState, type AppState as AppStateValue } from './AppState'
import { appStateTransitions } from './appStateTransitions'

export type AppStateTransition = {
  previousState: AppStateValue
  nextState: AppStateValue
}

export type AppStateListener = (transition: AppStateTransition) => void

export class AppStateMachine {
  private currentState: AppStateValue = AppState.IDLE
  private readonly listeners = new Set<AppStateListener>()

  getCurrentState(): AppStateValue {
    return this.currentState
  }

  canTransitionTo(target: AppStateValue): boolean {
    return target !== this.currentState && appStateTransitions[this.currentState].includes(target)
  }

  transitionTo(target: AppStateValue): boolean {
    if (!this.canTransitionTo(target)) return false

    const transition = { previousState: this.currentState, nextState: target }
    this.currentState = target
    this.listeners.forEach((listener) => listener(transition))
    return true
  }

  subscribe(listener: AppStateListener): () => void {
    this.listeners.add(listener)
    return () => this.unsubscribe(listener)
  }

  unsubscribe(listener: AppStateListener): void {
    this.listeners.delete(listener)
  }
}
