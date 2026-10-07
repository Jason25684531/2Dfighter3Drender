import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import { appStateTransitions } from '../state/appStateTransitions'
import type { UIFramework } from '../ui/UIFramework'
import { Button, Modal, Progress, RankingRow } from '../ui/Components'
import { InputManager } from '../input/InputManager'
import { GameClock } from '../time/GameClock'
import { intentFromInput } from '../combat/CombatWorld'
import { MatchController, type MatchSnapshot } from '../match/MatchController'
import { p6SubStateForRank, resolveMatchResult, type MatchResult } from '../match/ResultResolver'
import type { ExperiencePersistence } from '../app/ExperiencePersistence'

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
  private readonly buttons = new Map<string, Button>()
  private readonly inputManager = new InputManager()
  private readonly clock = new GameClock()
  private readonly match = new MatchController()
  private resolvedResult?: MatchResult
  private clockUnsubscribe?: () => void
  private battlePlayer?: Phaser.GameObjects.Rectangle
  private battleEnemy?: Phaser.GameObjects.Rectangle
  private battleInfo?: Phaser.GameObjects.Text
  private battleHitbox?: Phaser.GameObjects.Rectangle
  private battlePlayerHurtbox?: Phaser.GameObjects.Rectangle
  private battleEnemyHurtbox?: Phaser.GameObjects.Rectangle

  constructor(appStateMachine: AppStateMachine, ui: UIFramework, private readonly persistence?: ExperiencePersistence) {
    super('AppScene')
    this.appStateMachine = appStateMachine
    this.ui = ui
  }

  create(): void {
    if (typeof window !== 'undefined') this.inputManager.attachKeyboard(window)
    this.clock.start()
    this.unsubscribe = this.appStateMachine.subscribe(({ previousState, nextState }) => { if (nextState === AppState.READY) void this.persistence?.ensureSession().then(() => this.persistence?.beginMatch()).catch(() => this.ui.substates.set(AppState.READY, 'FALLBACK')); if (previousState === AppState.END && nextState === AppState.IDLE) void this.persistence?.finishSession().catch(() => undefined); if (nextState === AppState.BATTLE) { this.match.start(); void this.persistence?.beginMatch() }; if (nextState === AppState.SETUP || nextState === AppState.IDLE) { this.match.resetMatch(); this.persistence?.resetMatch(); this.resolvedResult = undefined }; this.render(nextState) })
    this.clockUnsubscribe = this.clock.subscribe(() => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) return
      this.match.tick(intentFromInput(this.inputManager.consumeGameplaySnapshot())); void this.persistence?.recordRounds(this.match.getRoundSummaries())
      const snapshot = this.match.getSnapshot(); this.ui.substates.set(AppState.BATTLE, this.match.getP4SubState()); this.renderBattle(snapshot)
      const completed = this.match.getCompletedMatch()
      if (completed && !this.resolvedResult) { this.resolvedResult = resolveMatchResult(completed); void this.persistence?.finishMatch(this.resolvedResult).then((stored) => { this.ui.substates.set(AppState.RESULT, p6SubStateForRank(stored?.rank ?? this.persistence?.context.snapshot.backendRank)); this.render(AppState.RESULT) }); this.appStateMachine.transitionTo(AppState.PRESENTATION) }
    })
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', () => this.render(this.appStateMachine.getCurrentState())))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', ({ open }) => {
      if (this.appStateMachine.getCurrentState() === AppState.BATTLE) { if (open) this.clock.pause(); else this.clock.resume() }
      this.render(this.appStateMachine.getCurrentState())
    }))
    this.uiUnsubscribers.push(this.ui.events.on('FOCUS_CHANGED', ({ previous, next }) => { this.buttons.get(previous ?? '')?.setFocused(false); this.buttons.get(next ?? '')?.setFocused(true) }))
    if (import.meta.env.DEV) {
      this.input.keyboard?.on('keydown-ONE', () => this.ui.substates.set(AppState.IDLE, 'RECORDS_1_TO_4'))
      this.input.keyboard?.on('keydown-TWO', () => this.ui.substates.set(AppState.IDLE, 'RECORDS_5_PLUS'))
      this.input.keyboard?.on('keydown-THREE', () => this.ui.substates.set(AppState.READY, 'PROCESSING'))
      this.input.keyboard?.on('keydown-FOUR', () => this.ui.substates.set(AppState.RESULT, 'RANK_1_TO_6'))
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.unsubscribe?.(); this.clockUnsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()); this.inputManager.detachKeyboard(); this.clock.stop() })
    this.render(this.appStateMachine.getCurrentState())
  }

  update(_time: number, delta: number): void {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => pad !== null) : []
    this.inputManager.update(gamepads)
    this.inputManager.consumeUiActions().forEach((action) => this.ui.navigation.dispatch(action))
    this.clock.advance(delta)
  }

  private render(state: AppStateValue): void {
    this.ui.focus.clearGroup('dev')
    this.buttons.clear()
    this.battlePlayer = undefined; this.battleEnemy = undefined; this.battleInfo = undefined; this.battleHitbox = undefined; this.battlePlayerHurtbox = undefined; this.battleEnemyHurtbox = undefined
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
    if (state === AppState.BATTLE) this.renderBattle(this.match.getSnapshot())
    if (state === AppState.IDLE) this.renderRecords()
    if (state === AppState.READY) this.renderReady()
    if (state === AppState.PRESENTATION) this.renderPresentation()
    if (state === AppState.RESULT) this.renderResults()
  }

  private renderRecords(): void { [1, 2, 3, 4].forEach((rank, index) => { const row = new RankingRow(this, rank, `PLAYER_${rank}`, rank * 100, this.ui.substates.get(AppState.IDLE) === 'RECORDS_1_TO_4'); row.setPosition(720, 680 + index * 28); this.screen?.add(row) }) }
  private renderReady(): void { const bar = new Progress(this, 300).setPosition(960, 680); bar.setProgress(this.ui.substates.get(AppState.READY) === 'PROCESSING' ? 0.5 : 1); this.screen?.add(bar) }
  private renderPresentation(): void { const result = this.resolvedResult; this.screen?.add(this.add.text(960, 690, result ? `MATCH ${result.outcome}  /  ${result.finishReason}` : 'MATCH COMPLETE', { fontFamily: 'Arial', fontSize: '30px', color: '#ffffff' }).setOrigin(0.5)) }
  private renderResults(): void { const row = new RankingRow(this, 1, 'MOCK_PLAYER', this.resolvedResult?.score ?? 0, true).setPosition(760, 680); this.screen?.add(row); if (this.resolvedResult) { const rank = this.persistence?.context.snapshot.backendRank; const state = this.persistence?.context.snapshot.persistence ?? 'IDLE'; this.screen?.add(this.add.text(960, 620, `${this.resolvedResult.outcome} · ${this.resolvedResult.title} · ${rank ?? 'NOT_RANKED'} · ${state}`, { fontFamily: 'Arial', fontSize: '28px', color: '#ffffff' }).setOrigin(0.5)) } }

  private renderBattle(snapshot: MatchSnapshot): void {
    if (!this.screen) return
    if (!this.battlePlayer || !this.battleEnemy || !this.battleInfo) {
      this.battlePlayer = this.add.rectangle(0, 0, 120, 220, 0x2f80ed)
      this.battleEnemy = this.add.rectangle(0, 0, 120, 220, 0xe60012)
      this.battleInfo = this.add.text(960, 760, '', { fontFamily: 'Arial', fontSize: '24px', color: '#ffffff' }).setOrigin(0.5)
      this.screen.add([this.battlePlayer, this.battleEnemy, this.battleInfo])
      if (import.meta.env.DEV) {
        this.battleHitbox = this.add.rectangle(0, 0, 1, 1, 0xffd166, 0.35)
        this.battlePlayerHurtbox = this.add.rectangle(0, 0, 1, 1, 0x2f80ed, 0.15)
        this.battleEnemyHurtbox = this.add.rectangle(0, 0, 1, 1, 0xe60012, 0.15)
        this.screen.add([this.battleHitbox, this.battlePlayerHurtbox, this.battleEnemyHurtbox])
      }
    }
    const player = snapshot.world.fighters.PLAYER; const enemy = snapshot.world.fighters.ENEMY
    this.battlePlayer.setPosition(player.x, player.y - 110); this.battleEnemy.setPosition(enemy.x, enemy.y - 110)
    this.battleInfo.setText(`P HP ${player.currentHP}  |  E HP ${enemy.currentHP}  |  ${Math.ceil(snapshot.remainingTicks / 24)}s  |  R${snapshot.roundNumber} ${snapshot.playerRoundWins}-${snapshot.enemyRoundWins}  |  C${player.combo}  |  T${snapshot.world.tick}`)
    if (import.meta.env.DEV && this.battleHitbox && this.battlePlayerHurtbox && this.battleEnemyHurtbox) {
      const place = (object: Phaser.GameObjects.Rectangle, box: { x: number; y: number; width: number; height: number } | undefined): void => { object.setVisible(Boolean(box)); if (box) object.setPosition(box.x + box.width / 2, box.y + box.height / 2).setSize(box.width, box.height) }
      place(this.battleHitbox, this.match.world.getActiveHitbox('PLAYER')); place(this.battlePlayerHurtbox, this.match.world.getHurtbox('PLAYER')); place(this.battleEnemyHurtbox, this.match.world.getHurtbox('ENEMY'))
    }
  }

  private renderDevNavigation(state: AppStateValue): void {
    this.screen?.add(this.add.text(960, 730, 'DEV NAVIGATION', { fontFamily: 'Arial', fontSize: '24px', color: '#e60012' }).setOrigin(0.5))
    appStateTransitions[state].forEach((target, index) => {
      const label = state === AppState.END ? (target === AppState.SETUP ? 'REPLAY → SETUP' : 'FINISH → IDLE') : `NEXT → ${target}`
      const button = new Button(this, `next-${target}`, label, () => this.appStateMachine.transitionTo(target)).setPosition(960, 790 + index * 62)
      this.ui.focus.register('dev', `next-${target}`, true, () => this.appStateMachine.transitionTo(target))
      this.buttons.set(`next-${target}`, button)
      this.screen?.add(button)
    })
    this.ui.focus.activate('dev')
  }
}
