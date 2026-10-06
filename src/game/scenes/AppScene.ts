import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import { appStateTransitions } from '../state/appStateTransitions'
import type { UIFramework } from '../ui/UIFramework'
import { Button, Modal, Progress, RankingRow } from '../ui/Components'

const screenLabels: Record<AppStateValue, string> = {
  [AppState.IDLE]: 'IDLE',
  [AppState.READY]: 'READY',
  [AppState.SETUP]: 'SETUP',
  [AppState.LOADING]: 'LOADING',
  [AppState.BATTLE]: 'BATTLE PLACEHOLDER',
  [AppState.PRESENTATION]: 'PRESENTATION',
  [AppState.RESULT]: 'RESULT',
  [AppState.END]: 'END',
}

export class AppScene extends Phaser.Scene {
  private readonly appStateMachine: AppStateMachine
  private screen?: Phaser.GameObjects.Container
  private unsubscribe?: () => void
  private readonly ui: UIFramework
  private readonly uiUnsubscribers: Array<() => void> = []

  constructor(appStateMachine: AppStateMachine, ui: UIFramework) {
    super('AppScene')
    this.appStateMachine = appStateMachine
    this.ui = ui
  }

  create(): void {
    this.unsubscribe = this.appStateMachine.subscribe(({ nextState }) => this.render(nextState))
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', () => this.render(this.appStateMachine.getCurrentState())))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', () => this.render(this.appStateMachine.getCurrentState())))
    if (import.meta.env.DEV) this.input.keyboard?.on('keydown-ESC', () => this.ui.navigation.dispatch(this.ui.navigation.isOverlayOpen() ? 'CLOSE_MENU' : 'OPEN_MENU'))
    if (import.meta.env.DEV) {
      this.input.keyboard?.on('keydown-UP', () => this.ui.navigation.dispatch('NAV_UP'))
      this.input.keyboard?.on('keydown-DOWN', () => this.ui.navigation.dispatch('NAV_DOWN'))
      this.input.keyboard?.on('keydown-ONE', () => this.ui.substates.set(AppState.IDLE, 'RECORDS_1_TO_4'))
      this.input.keyboard?.on('keydown-TWO', () => this.ui.substates.set(AppState.IDLE, 'RECORDS_5_PLUS'))
      this.input.keyboard?.on('keydown-THREE', () => this.ui.substates.set(AppState.READY, 'PROCESSING'))
      this.input.keyboard?.on('keydown-FOUR', () => this.ui.substates.set(AppState.RESULT, 'RANK_1_TO_6'))
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.unsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()) })
    this.render(this.appStateMachine.getCurrentState())
  }

  private render(state: AppStateValue): void {
    this.screen?.destroy()
    this.screen = this.add.container()
    this.screen.add([
      this.add.rectangle(960, 540, 1920, 1080, 0x090b12),
      this.add.rectangle(960, 470, 980, 360, 0x191d2c).setStrokeStyle(4, 0xe60012),
      this.add.text(960, 380, state, { fontFamily: 'Arial', fontSize: '42px', color: '#aeb9d6' }).setOrigin(0.5),
      this.add.text(960, 485, screenLabels[state], { fontFamily: 'Arial', fontSize: '76px', color: '#ffffff' }).setOrigin(0.5),
      this.add.text(960, 570, 'D1 FRAMEWORK PLACEHOLDER', { fontFamily: 'Arial', fontSize: '24px', color: '#aeb9d6' }).setOrigin(0.5),
      this.add.text(960, 620, `UI: ${this.ui.substates.get(state)}`, { fontFamily: 'Arial', fontSize: '24px', color: '#aeb9d6' }).setOrigin(0.5),
    ])

    if (import.meta.env.DEV) this.renderDevNavigation(state)
    if (this.ui.navigation.isOverlayOpen()) this.screen.add(this.add.text(960, 180, 'HOME / PAUSE OVERLAY', { fontFamily: 'Arial', fontSize: '32px', color: '#ffffff', backgroundColor: '#e60012', padding: { x: 20, y: 12 } }).setOrigin(0.5))
    if (state === AppState.IDLE) this.renderRecords()
    if (state === AppState.READY) this.renderReady()
    if (state === AppState.RESULT) this.renderResults()
  }

  private renderRecords(): void { [1, 2, 3, 4].forEach((rank, index) => { const row = new RankingRow(this, rank, `PLAYER_${rank}`, rank * 100, this.ui.substates.get(AppState.IDLE) === 'RECORDS_1_TO_4'); row.setPosition(720, 680 + index * 28); this.screen?.add(row) }) }
  private renderReady(): void { const bar = new Progress(this, 300).setPosition(960, 680); bar.setProgress(this.ui.substates.get(AppState.READY) === 'PROCESSING' ? 0.5 : 1); this.screen?.add(bar) }
  private renderResults(): void { const row = new RankingRow(this, 1, 'MOCK_PLAYER', 999, true).setPosition(760, 680); this.screen?.add(row) }

  private renderDevNavigation(state: AppStateValue): void {
    this.screen?.add(this.add.text(960, 730, 'DEV NAVIGATION', { fontFamily: 'Arial', fontSize: '24px', color: '#e60012' }).setOrigin(0.5))
    appStateTransitions[state].forEach((target, index) => {
      const label = state === AppState.END ? (target === AppState.SETUP ? 'REPLAY → SETUP' : 'FINISH → IDLE') : `NEXT → ${target}`
      const button = new Button(this, `next-${target}`, label, () => this.appStateMachine.transitionTo(target)).setPosition(960, 790 + index * 62)
      this.ui.focus.register('dev', `next-${target}`)
      this.screen?.add(button)
    })
    this.ui.focus.activate('dev')
  }
}
