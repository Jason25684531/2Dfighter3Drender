import { AppState } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { FocusManager } from './FocusManager'
import type { UIEventBus } from './UIEventBus'
export type UIAction = 'NAV_UP' | 'NAV_DOWN' | 'NAV_LEFT' | 'NAV_RIGHT' | 'CONFIRM' | 'BACK' | 'REPLAY' | 'FINISH' | 'OPEN_MENU' | 'CLOSE_MENU'
export class NavigationManager {
  private overlayOpen = false
  private overlayConfirm = false
  constructor(private readonly app: AppStateMachine, private readonly focus: FocusManager, private readonly events: UIEventBus) {}
  isOverlayOpen(): boolean { return this.overlayOpen }
  dispatch(action: UIAction): boolean {
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
