import { describe, expect, it, vi } from 'vitest'
import sceneSource from '../scenes/AppScene.ts?raw'
import { AppState } from '../state/AppState'
import { AppStateMachine } from '../state/AppStateMachine'
import { UIFramework } from './UIFramework'
import { MatchController } from '../match/MatchController'
import { healthRatio, panelPoints } from './presentationMath'
import { uiTokens } from './tokens/uiTokens'

describe('Cyber Arena navigation and presentation', () => {
  it('allows only declared back routes and preserves pause and confirmation behavior', () => {
    const app = new AppStateMachine(), ui = new UIFramework(app)
    expect(ui.navigation.dispatch('BACK')).toBe(false)
    app.transitionTo(AppState.READY); app.transitionTo(AppState.SETUP)
    ui.navigation.dispatch('BACK'); expect(app.getCurrentState()).toBe(AppState.READY)
    ui.navigation.dispatch('BACK'); expect(app.getCurrentState()).toBe(AppState.IDLE)
    const path = [AppState.READY, AppState.SETUP, AppState.LOADING, AppState.BATTLE, AppState.PRESENTATION, AppState.RESULT, AppState.END]
    path.forEach((state) => expect(app.transitionTo(state)).toBe(true))
    expect(ui.navigation.dispatch('BACK')).toBe(false); expect(app.getCurrentState()).toBe(AppState.END)
    app.transitionTo(AppState.IDLE)
    // P3／P5／P6：BACK 回主畫面
    for (const home of [AppState.LOADING, AppState.PRESENTATION, AppState.RESULT]) {
      path.slice(0, path.indexOf(home) + 1).forEach((state) => app.transitionTo(state))
      expect(ui.navigation.dispatch('BACK')).toBe(true); expect(app.getCurrentState()).toBe(AppState.IDLE)
    }
    path.slice(0, 4).forEach((state) => app.transitionTo(state))
    ui.navigation.dispatch('BACK'); expect(ui.navigation.isOverlayOpen()).toBe(true)
    ui.navigation.openExitConfirmation(); ui.navigation.dispatch('BACK')
    expect(ui.navigation.isExitConfirmationOpen()).toBe(false); expect(ui.navigation.isOverlayOpen()).toBe(true)
    ui.navigation.dispatch('BACK'); expect(ui.navigation.isOverlayOpen()).toBe(false)
  })
  it('publishes previous focus on hover and resumes keyboard navigation there without activating', () => {
    const ui = new UIFramework(new AppStateMachine()), event = vi.fn(), action = vi.fn()
    ui.events.on('FOCUS_CHANGED', event)
    ui.focus.register('character', 'a', true, action); ui.focus.register('character', 'b'); ui.focus.register('character', 'disabled', false)
    ui.focus.activate('character', 'a'); ui.focus.activate('character', 'b')
    expect(event).toHaveBeenLastCalledWith({group:'character',previous:'a',next:'b'})
    expect(action).not.toHaveBeenCalled(); ui.navigation.dispatch('NAV_RIGHT'); expect(ui.focus.current()).toBe('a')
  })
  it('clamps geometry and HP', () => {
    expect(panelPoints(100, 60, 20)).toEqual([-30,-30,50,-30,30,30,-50,30])
    expect(panelPoints(100, 60, 100)[0]).toBe(-20)
    expect([healthRatio(-1),healthRatio(0.4),healthRatio(2)]).toEqual([0,0.4,1])
  })
  it('uses Concept A tokens and prevents screen font-size literals', () => {
    expect(uiTokens.slant).toBe(28); expect(uiTokens.colors.playerPrimary).toBe(0xe5172f)
    expect(Object.values(uiTokens.type)).toEqual([260,120,72,40,30,24,18])
    expect(uiTokens.fonts.display).toContain('Oswald')
    expect(sceneSource).not.toMatch(/fontSize:\s*['"]\d+px['"]|fontSize:\s*\d+/)
  })
})
