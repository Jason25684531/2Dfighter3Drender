import { AppState } from '../state/AppState'
import { backRoutes } from '../state/appStateTransitions'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { FocusManager } from './FocusManager'
import type { UIEventBus } from './UIEventBus'
export type UIAction = 'NAV_UP' | 'NAV_DOWN' | 'NAV_LEFT' | 'NAV_RIGHT' | 'CONFIRM' | 'BACK' | 'REPLAY' | 'FINISH' | 'OPEN_MENU' | 'CLOSE_MENU'
export class NavigationManager {
  private overlayOpen = false
  private overlayConfirm = false
  constructor(private readonly app: AppStateMachine, private readonly focus: FocusManager, private readonly events: UIEventBus) {}
  private backHandler?: () => boolean
  /** 畫面內子步驟的返回：回傳 true 表示已處理，不再走 declared back route。 */
  setBackHandler(handler: (() => boolean) | undefined): void { this.backHandler = handler }
  isOverlayOpen(): boolean { return this.overlayOpen }
  dispatch(action: UIAction): boolean {
    if (action === 'BACK' && !this.overlayOpen) {
      if (this.backHandler?.()) return true
      const state = this.app.getCurrentState(), back = backRoutes[state]
      if (back) return this.app.transitionTo(back)
      if (state !== AppState.BATTLE) return false
    }
    if (action === 'NAV_UP' || action === 'NAV_LEFT') { this.focus.move(-1); return true }; if (action === 'NAV_DOWN' || action === 'NAV_RIGHT') { this.focus.move(1); return true }
    if (action === 'OPEN_MENU' || action === 'CLOSE_MENU' || action === 'BACK') {
      if (action === 'BACK' && this.overlayOpen && this.overlayConfirm) { this.overlayConfirm = false; this.focus.activate('overlay'); this.events.emit('OVERLAY_CHANGED', { open: true }); return true }
      const open = action === 'OPEN_MENU' ? true : action === 'CLOSE_MENU' ? false : !this.overlayOpen
      if (this.overlayOpen !== open) { this.overlayOpen = open; this.overlayConfirm = false; this.events.emit('OVERLAY_CHANGED', { open }) }
      return true
    }
    if (action === 'REPLAY') return this.app.transitionTo(AppState.SETUP)
    if (action === 'FINISH') return this.app.transitionTo(AppState.IDLE)
    return action === 'CONFIRM' ? this.focus.activateFocused() : false
  }
  openExitConfirmation(): boolean { if (!this.overlayOpen) return false; this.overlayConfirm = true; this.events.emit('OVERLAY_CHANGED', { open: true }); return true }
  isExitConfirmationOpen(): boolean { return this.overlayConfirm }
}
