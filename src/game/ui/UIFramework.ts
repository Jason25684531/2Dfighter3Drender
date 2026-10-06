import type { AppStateMachine } from '../state/AppStateMachine'
import { FocusManager } from './FocusManager'
import { NavigationManager } from './NavigationManager'
import { ScreenSubState } from './ScreenSubState'
import { UIEventBus } from './UIEventBus'
export class UIFramework {
  readonly events = new UIEventBus(); readonly substates = new ScreenSubState(this.events); readonly focus = new FocusManager(this.events)
  readonly navigation: NavigationManager
  constructor(app: AppStateMachine) { this.navigation = new NavigationManager(app, this.focus, this.events); app.subscribe(({ previousState }) => { this.substates.reset(previousState); this.focus.reset() }) }
}
