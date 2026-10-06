import { describe, expect, it, vi } from 'vitest'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { FocusManager } from './FocusManager'
import { NavigationManager } from './NavigationManager'
import { ScreenSubState } from './ScreenSubState'
import { UIEventBus } from './UIEventBus'
const end = (app: AppStateMachine) => [AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE, AppState.PRESENTATION, AppState.RESULT, AppState.END].forEach((s) => app.transitionTo(s))
describe('D2 UI framework', () => {
  it('has deterministic isolated substates and rejects invalid values', () => { const s = new ScreenSubState(new UIEventBus()); expect(s.get(AppState.IDLE)).toBe('EMPTY'); expect(s.get(AppState.READY)).toBe('READY'); expect(s.get(AppState.RESULT)).toBe('NOT_RANKED'); expect(s.set(AppState.IDLE, 'RECORDS_1_TO_4')).toBe(true); expect(s.set(AppState.IDLE, 'READY')).toBe(false); expect(s.get(AppState.READY)).toBe('READY'); s.reset(AppState.IDLE); expect(s.get(AppState.IDLE)).toBe('EMPTY') })
  it('moves focus, skips disabled, and handles empty groups', () => { const e = new UIEventBus(), f = new FocusManager(e); f.activate('empty'); expect(f.current()).toBeUndefined(); f.register('p2', 'a'); f.register('p2', 'b', false); f.register('p2', 'c'); f.activate('p2'); expect(f.current()).toBe('a'); f.move(1); expect(f.current()).toBe('c'); f.unregister('p2', 'c'); expect(f.current()).toBe('a') })
  it('routes overlay and end actions through D1', () => { const e = new UIEventBus(), app = new AppStateMachine(), n = new NavigationManager(app, new FocusManager(e), e); n.dispatch('OPEN_MENU'); n.dispatch('OPEN_MENU'); expect(n.isOverlayOpen()).toBe(true); expect(app.getCurrentState()).toBe(AppState.IDLE); n.dispatch('CLOSE_MENU'); end(app); expect(n.dispatch('REPLAY')).toBe(true); end(app); expect(n.dispatch('FINISH')).toBe(true); expect(app.getCurrentState()).toBe(AppState.IDLE) })
  it('removes event listeners', () => { const e = new UIEventBus(), listener = vi.fn(), off = e.on('OVERLAY_CHANGED', listener); off(); e.emit('OVERLAY_CHANGED', { open: true }); expect(listener).not.toHaveBeenCalled() })
})
