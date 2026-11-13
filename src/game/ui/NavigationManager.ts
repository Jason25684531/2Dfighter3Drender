import { AppState } from '../state/AppState'
import { backRoutes } from '../state/appStateTransitions'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { FocusManager } from './FocusManager'
import type { UIEventBus } from './UIEventBus'
export type UIAction = 'NAV_UP' | 'NAV_DOWN' | 'NAV_LEFT' | 'NAV_RIGHT' | 'CONFIRM' | 'BACK' | 'REPLAY' | 'FINISH' | 'OPEN_MENU' | 'CLOSE_MENU'
export class NavigationManager {
  private overlayOpen = false
  private overlayConfirm?: 'RESTART' | 'EXIT'
  constructor(private readonly app: AppStateMachine, private readonly focus: FocusManager, private readonly events: UIEventBus) {}
  isOverlayOpen(): boolean { return this.overlayOpen }
  dispatch(action: UIAction): boolean {
    const handled = this.handle(action)
    this.events.emit('UI_ACTION', { action, handled })
    return handled
  }
  private handle(action: UIAction): boolean {
    if (action === 'BACK' && !this.overlayOpen) {
      const state = this.app.getCurrentState(), back = backRoutes[state]
      if (back) return this.app.transitionTo(back)
      if (state !== AppState.BATTLE) return false
    }
    if (action === 'NAV_UP' || action === 'NAV_LEFT') { this.focus.move(-1); return true }; if (action === 'NAV_DOWN' || action === 'NAV_RIGHT') { this.focus.move(1); return true }
    if (action === 'OPEN_MENU' || action === 'CLOSE_MENU' || action === 'BACK') {
      if (action === 'BACK' && this.overlayOpen && this.overlayConfirm) { this.overlayConfirm = undefined; this.focus.activate('overlay'); this.events.emit('OVERLAY_CHANGED', { open: true }); return true }
      const open = action === 'OPEN_MENU' ? true : action === 'CLOSE_MENU' ? false : !this.overlayOpen
      if (this.overlayOpen !== open) { this.overlayOpen = open; this.overlayConfirm = undefined; this.events.emit('OVERLAY_CHANGED', { open }) }
      return true
    }
    if (action === 'REPLAY') return this.app.getCurrentState() === AppState.END && this.app.transitionTo(AppState.READY)
    if (action === 'FINISH') return this.app.transitionTo(AppState.IDLE)
    return action === 'CONFIRM' ? this.focus.activateFocused() : false
  }
  openExitConfirmation(action: 'RESTART' | 'EXIT' = 'EXIT'): boolean { if (!this.overlayOpen) return false; this.overlayConfirm = action; this.events.emit('OVERLAY_CHANGED', { open: true }); return true }
  isExitConfirmationOpen(): boolean { return this.overlayConfirm !== undefined }
  getConfirmationAction(): 'RESTART' | 'EXIT' | undefined { return this.overlayConfirm }
}
