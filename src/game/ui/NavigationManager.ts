import { AppState } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { FocusManager } from './FocusManager'
import type { UIEventBus } from './UIEventBus'
export type UIAction = 'NAV_UP' | 'NAV_DOWN' | 'CONFIRM' | 'BACK' | 'REPLAY' | 'FINISH' | 'OPEN_MENU' | 'CLOSE_MENU'
export class NavigationManager {
  private overlayOpen = false
  constructor(private readonly app: AppStateMachine, private readonly focus: FocusManager, private readonly events: UIEventBus) {}
  isOverlayOpen(): boolean { return this.overlayOpen }
  dispatch(action: UIAction): boolean {
    if (action === 'NAV_UP') { this.focus.move(-1); return true }; if (action === 'NAV_DOWN') { this.focus.move(1); return true }
    if (action === 'OPEN_MENU' || action === 'CLOSE_MENU' || action === 'BACK') { const open = action === 'OPEN_MENU'; if (this.overlayOpen !== open) { this.overlayOpen = open; this.events.emit('OVERLAY_CHANGED', { open }) }; return true }
    if (action === 'REPLAY') return this.app.transitionTo(AppState.SETUP)
    if (action === 'FINISH') return this.app.transitionTo(AppState.IDLE)
    return action === 'CONFIRM'
  }
}
