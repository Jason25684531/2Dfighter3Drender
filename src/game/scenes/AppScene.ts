import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { UIFramework } from '../ui/UIFramework'
import { ActionButton, addFocalGlow, AngularPanel, fighterSilhouette, HealthBar, StageCard, RoundDiamonds, HexTimer, KeyCap, RoundBanner } from '../ui/VisualComponents'
import { stopOwnedTweens } from '../ui/tweens'
import { roundBannerSequence } from '../ui/presentationMath'
import { uiTokens, colorHex, reducedMotion } from '../ui/tokens/uiTokens'
import { aspectCover } from '../ui/tokens/layout'
import { typography } from '../ui/tokens/typography'
import { InputManager, type OwnedUiAction, type PlayerSlotId } from '../input/InputManager'
import { FIXED_STEP_MS, GameClock } from '../time/GameClock'
import { DEFAULT_COMBAT_CONFIG, intentFromInput, type CombatEvent } from '../combat/CombatWorld'
import { MatchController, type MatchSnapshot } from '../match/MatchController'
import { resolveAiProfile } from '../config/aiProfiles'
import { p6SubStateForRank, resolveMatchResult, type MatchResult, type P6SubState } from '../match/ResultResolver'
import type { ExperiencePersistence } from '../app/ExperiencePersistence'
import type { PlayerSelection } from '../app/ExperienceContext'
import { P1SelectionModel, type P1Phase } from '../select/P1SelectionModel'
import { OpponentSelectModel, type OpponentChoice } from '../select/OpponentSelectModel'
import { LeaderboardPanel } from '../ui/board/LeaderboardPanel'
import { P1SelectView } from '../ui/p1/P1SelectView'
import type { LeaderboardEntry } from '../api/ApiTypes'
import { battleViewModel, endViewModel, leaderboardPanelModel, loadingViewModel, mockResultViewModel, presentationViewModel, resultViewModel, stageSelectViewModel, type P5ShowcaseVariant, type ResultViewModel } from '../ui/ViewModels'
import { characterEntry, resolveStageAsset, stageTextureKey, testCharacterManifest, type CharacterEntry, type StageId } from '../ui/assets/TestAssetManifest'
import { TemporarySpriteRenderer } from '../ui/animation/TemporarySpriteRenderer'
import { presentationSheet, resolvePresentation, spriteActionFor, spriteTextureFrame, spriteTextureKey, type PresentationContext, type SpriteId } from '../ui/animation/TemporarySpriteManifest'
import { isSheetSprite, sheetAnimations, sheetUrl } from '../ui/animation/SheetSpriteManifest'
import { ControlsEditor, keyLabel, loadProfiles, saveProfiles, type CombatAction } from '../input/ControlProfile'
import { ControlsPanel } from '../ui/controls/ControlsPanel'
import { StageParallax } from '../ui/stage/StageParallax'
import { stageCamera, worldX, WORLD_ZOOM } from '../ui/stage/StageCamera'
import { AnimationLab } from '../ui/showcase/AnimationLab'

type Focusable = Phaser.GameObjects.Container & { setFocused: (focused: boolean) => unknown }

export class AppScene extends Phaser.Scene {
  private readonly appStateMachine: AppStateMachine
  private screen?: Phaser.GameObjects.Container
  private unsubscribe?: () => void
  private readonly ui: UIFramework
  private readonly uiUnsubscribers: Array<() => void> = []
  private readonly buttons = new Map<string, Focusable>()
  private readonly screenTweens: Phaser.Tweens.Tween[] = []
  private readonly inputManager = new InputManager()
  private readonly clock = new GameClock()
  private readonly match = new MatchController(DEFAULT_COMBAT_CONFIG, { intro: true })
  private readonly persistence?: ExperiencePersistence
  private resolvedResult?: MatchResult
  private leaderboardEntries: LeaderboardEntry[] = []
  private nextPlayerName?: string
  private clockUnsubscribe?: () => void
  private combatUnsubscribe?: () => void
  private tickEvents: CombatEvent[] = []
  private firstHit?: { round: number; tick: number; byPlayer: boolean }
  private battlePlayer?: TemporarySpriteRenderer
  private battleEnemy?: TemporarySpriteRenderer
  private battleTimer?: HexTimer
  private battleCombo?: Phaser.GameObjects.Text
  private battleDanger?: Phaser.GameObjects.Text
  private battleFirstAttack?: Phaser.GameObjects.Text
  private battleBanner?: RoundBanner
  private previousBattle?: MatchSnapshot
  private battleLastTen?: Phaser.GameObjects.Text
  private keyCaps: KeyCap[] = []
  private promptDevice?: string
  private loadingButton?: ActionButton
  private loadingBar?: Phaser.GameObjects.Rectangle
  private loadingPercent?: Phaser.GameObjects.Text
  private loadingReady?: boolean
  private loadingPulse?: Phaser.Tweens.Tween
  private battlePlayerBar?: HealthBar
  private battleEnemyBar?: HealthBar
  private battlePlayerRounds?: RoundDiamonds
  private battleEnemyRounds?: RoundDiamonds
  private battleRoot?: Phaser.GameObjects.Container
  private selectedCharacterId = 'preset-a'
  private selectedStageId: StageId = 'laboratory'
  private showcaseEnabled = false
  private overlay?: Phaser.GameObjects.Container
  private showcaseState?: AppStateValue
  private showcaseLab = false
  private labIndex = 0
  private labFacing: 'LEFT' | 'RIGHT' = 'RIGHT'
  private labHud = true
  private labLoop = true
  private showcaseAnnouncer = false
  private showcaseBattleVariant: 'NORMAL' | 'COMBO' | 'DANGER' | 'LAST_10_SECONDS' = 'NORMAL'
  private showcaseP5Variant: P5ShowcaseVariant = 'KO'
  private showcaseP6SubState: P6SubState = 'RANK_1_TO_6'
  private p1Model?: P1SelectionModel
  private p1View?: P1SelectView
  private p1Offline = false
  private players: Partial<Record<PlayerSlotId, PlayerSelection>> = {}
  private lastActivity = 0
  private idleLabel?: Phaser.GameObjects.Text
  private stageBackdrop?: Phaser.GameObjects.Image
  private stage?: StageParallax
  private battleWorld?: Phaser.GameObjects.Container
  private stageScroll = 0
  private attract?: Phaser.GameObjects.DOMElement
  private readonly controls = loadProfiles()
  private controlsPanel?: ControlsPanel
  private boardPanel?: LeaderboardPanel
  private boardRequest = 0
  private opponentModel?: OpponentSelectModel
  private opponent?: OpponentChoice
  private readonly playerContext: PresentationContext = {}
  private inputDebug?: Phaser.GameObjects.Text
  private readonly noteActivity = (): void => { this.lastActivity = this.time.now }
  private readonly showcaseListeners: Array<{ event: string; listener: () => void }> = []

  constructor(appStateMachine: AppStateMachine, ui: UIFramework, persistence?: ExperiencePersistence) {
    super('AppScene'); this.appStateMachine = appStateMachine; this.ui = ui; this.persistence = persistence
  }

  create(): void {
    const context = this.persistence?.context.snapshot
    this.selectedCharacterId = context?.selectedCharacterId ?? 'preset-a'; this.selectedStageId = resolveStageAsset(context?.selectedStageId).id; this.players = context?.players ?? {}
    this.input.on('pointermove', this.noteActivity); this.input.on('pointerdown', this.noteActivity)
    if (typeof window !== 'undefined') this.inputManager.attachKeyboard(window)
    this.inputManager.setCombatBindings(this.controls.P1)
    this.input.keyboard?.on('keydown', this.attractKey); this.noteActivity()
    if (import.meta.env.DEV && typeof window !== 'undefined') { const params = new URLSearchParams(window.location.search); this.showcaseEnabled = params.get('uiShowcase') === '1'; if (this.showcaseEnabled) this.showcaseState = AppState.IDLE }
    this.clock.start()
    this.ui.navigation.setBackHandler(() => this.handleSetupBack())
    void this.persistence?.leaderboard().then((entries) => { this.leaderboardEntries = entries })
    this.unsubscribe = this.appStateMachine.subscribe(({ previousState, nextState }) => {
      if (nextState === AppState.READY) void this.persistence?.ensureSession().then(() => { if (this.appStateMachine.getCurrentState() === AppState.IDLE) return this.persistence?.finishSession() }).catch(() => { this.p1Offline = true; this.p1View?.setOffline() })
      if (nextState === AppState.READY) { this.p1Model = new P1SelectionModel(); this.p1Offline = false }
      this.lastActivity = this.time.now
      if (nextState !== AppState.IDLE) { this.stopAttract(); this.closeControls(); this.closeBoard() }
      if (previousState === AppState.SETUP && nextState !== AppState.SETUP && this.ui.substates.get(AppState.SETUP) !== 'DEFAULT') this.ui.substates.reset(AppState.SETUP)
      if (nextState === AppState.SETUP) this.enterSetup()
      // P4 暫停離開與 P7 Finish 都結束 session；後端會把未完成的對戰標為 ABANDONED。
      if ((previousState === AppState.END || previousState === AppState.BATTLE || previousState === AppState.READY) && nextState === AppState.IDLE) void this.persistence?.finishSession().catch(() => undefined)
      if (nextState === AppState.BATTLE) { this.previousBattle = undefined; this.stageScroll = 0; this.match.setAiProfile(resolveAiProfile(this.players.P2 ? undefined : this.opponent?.difficulty)); this.match.start(); this.tickEvents = []; this.firstHit = undefined; this.combatUnsubscribe?.(); this.combatUnsubscribe = this.match.world.subscribe((event) => { this.tickEvents.push(event) }); void this.persistence?.beginMatch().catch(() => undefined) }
      if (nextState === AppState.SETUP || nextState === AppState.IDLE) { this.match.resetMatch(); this.persistence?.resetMatch(); this.resolvedResult = undefined; this.nextPlayerName = undefined }
      if (nextState === AppState.IDLE) { this.players = {}; this.opponent = undefined; this.opponentModel = undefined }
      this.render(nextState)
    })
    this.clockUnsubscribe = this.clock.subscribe(() => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) return
      const input = this.inputManager.consumeGameplaySnapshot()
      const frozen = this.match.getSnapshot().matchState === 'READY' // 起手序列：輸入不影響角色，連出招動畫也不播
      if (input.attack && !frozen) this.playerContext.attack = input.attack
      this.playerContext.crouch = frozen ? false : input.crouchHeld
      this.match.tick(intentFromInput(input)); void this.persistence?.recordRounds(this.match.getRoundSummaries()).catch(() => undefined)
      const snapshot = this.match.getSnapshot(); this.ui.substates.set(AppState.BATTLE, this.match.getP4SubState()); this.updateBattle(snapshot)
      const completed = this.match.getCompletedMatch()
      if (completed && !this.resolvedResult) { this.resolvedResult = resolveMatchResult(completed); void this.persistence?.finishMatch(this.resolvedResult).then(async (stored) => { this.ui.substates.set(AppState.RESULT, p6SubStateForRank(stored?.rank ?? this.persistence?.context.snapshot.backendRank)); this.leaderboardEntries = await this.persistence?.leaderboard() ?? []; this.nextPlayerName = await this.persistence?.nextQueuedPlayer(); this.render(this.appStateMachine.getCurrentState()) }).catch(() => undefined); this.appStateMachine.transitionTo(AppState.PRESENTATION) }
    })
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', ({ screen }) => { if (screen === AppState.BATTLE && this.battleRoot && !this.showcaseState) return; this.render(this.appStateMachine.getCurrentState()) }))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', ({ open }) => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) { this.render(this.appStateMachine.getCurrentState()); return }
      if (open) this.clock.pause(); else this.clock.resume()
      this.stage?.pause(open)
      // Keep fighter interpolation history intact while opening or closing the menu.
      this.ui.focus.clearGroup('overlay'); this.ui.focus.clearGroup('overlay-confirm')
      this.overlay?.destroy(true); this.overlay = undefined
      if (open) this.renderOverlay()
    }))
    this.uiUnsubscribers.push(this.ui.events.on('FOCUS_CHANGED', ({ previous, next }) => { this.buttons.get(previous ?? '')?.setFocused(false); this.buttons.get(next ?? '')?.setFocused(true) }))
    if (import.meta.env.DEV && this.showcaseEnabled) this.installShowcaseKeys()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyScene())
    this.render(this.appStateMachine.getCurrentState())
  }

  update(_time: number, delta: number): void { const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => pad !== null) : []; this.inputManager.update(gamepads)
    const battling = this.appStateMachine.getCurrentState() === AppState.BATTLE
    const visualState = this.showcaseState ?? this.appStateMachine.getCurrentState()
    const menuScreen = !this.showcaseLab && visualState === AppState.BATTLE
    const backScreen = visualState === AppState.READY || visualState === AppState.SETUP
    const owned = this.inputManager.consumeOwnedUiActions(), actions = this.inputManager.consumeUiActions()
    if (owned.length || actions.length) this.lastActivity = _time
    const typing = document.activeElement instanceof HTMLInputElement, pause = this.inputManager.consumePause()
    if (this.attract || this.controlsPanel || this.boardPanel) {
      // 開頭動畫、操作設定或排行榜開啟中：UI 輸入不穿透到 P0；手把的 BACK／CONFIRM 可關閉排行榜。
      if (this.boardPanel && actions.some((action) => action === 'BACK' || action === 'CONFIRM')) this.closeBoard()
    } else if (!typing && visualState === AppState.READY && this.p1Model) {
      // P1 由 1P/2P 擁有者鍵位操作；未標記輸入只保留 Esc（選角中返回標題）。
      if (this.p1View?.exitOpen) this.p1View.handleExit(actions)
      else if (actions.includes('BACK')) {
        if (this.p1Model.owner) this.p1View?.confirmExit(() => { this.p1Model?.abortCustomize(); this.syncP1() })
        else this.ui.navigation.dispatch('BACK')
      } else owned.forEach(({ owner, action }) => this.p1Input(owner, action))
    } else if (menuScreen && !this.ui.navigation.isOverlayOpen()) {
      // P4 未暫停：只看 Combat profile 的 PAUSE，選單鍵不作用；暫停後才交給選單鍵。
      if (pause) this.ui.navigation.dispatch('OPEN_MENU')
    } else if (!typing) {
      // 暫停選單只屬於 P4；其他畫面的 Escape／M 不開啟選單。
      actions.filter((action) => this.ui.navigation.isOverlayOpen() || menuScreen || (action === 'BACK' && backScreen) || (action !== 'OPEN_MENU' && action !== 'BACK')).forEach((action) => this.ui.navigation.dispatch(action))
    }
    this.checkIdle(_time)
    // 選單或暫停中的跳躍／攻擊按下不留到戰鬥（手把 A 同時是 CONFIRM 與 JUMP）。
    if (!battling || this.clock.isPaused()) this.inputManager.consumeGameplaySnapshot()
    this.clock.advance(delta)
    if (this.appStateMachine.getCurrentState() === AppState.BATTLE) {
      const alpha = Phaser.Math.Clamp(this.clock.getRemainderMs() / FIXED_STEP_MS, 0, 1)
      this.battlePlayer?.renderAt(alpha); this.battleEnemy?.renderAt(alpha)
      // 鏡頭只改呈現：在插值後依兩名角色位置更新，不回寫 Combat。
      if (this.battlePlayer && this.battleEnemy) { this.stageScroll = stageCamera(this.stageScroll, this.battlePlayer.x, this.battleEnemy.x, reducedMotion ? Infinity : delta / 1000); this.placeWorld() }
    }
    if (visualState === AppState.LOADING) this.updateLoading() }

  private render(state: AppStateValue, override?: AppStateValue): void {
    const visualState = override ?? this.showcaseState ?? state
    this.destroyScreen(); document.body.style.setProperty('--backdrop', `url("${resolveStageAsset(this.selectedStageId).url}")`); this.screen = this.add.container(0, 0).setAlpha(reducedMotion ? 1 : 0); this.addBackground(this.screen, visualState)
    if (this.showcaseLab) { this.screen.add(new AnimationLab(this, { stageId: this.selectedStageId, index: this.labIndex, facing: this.labFacing, hud: this.labHud, loop: this.labLoop })); this.addScreenTween({ targets: this.screen, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' }); return }
    if (visualState === AppState.IDLE) this.renderP0(); if (visualState === AppState.READY) this.renderP1(); if (visualState === AppState.SETUP) this.renderP2(); if (visualState === AppState.LOADING) this.renderP3(); if (visualState === AppState.BATTLE) { this.renderP4(); this.updateBattle(this.match.getSnapshot()) }; if (visualState === AppState.PRESENTATION) this.renderP5(); if (visualState === AppState.RESULT) this.renderP6(); if (visualState === AppState.END) this.renderP7()
    if (this.ui.navigation.isOverlayOpen()) this.renderOverlay()
    this.addScreenTween({ targets: this.screen, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' })
  }

  private addBackground(container: Phaser.GameObjects.Container, state: AppStateValue): void {
    if (this.showcaseLab || state === AppState.BATTLE || state === AppState.PRESENTATION) return
    const darkness = state === AppState.IDLE ? uiTokens.backdrop.empty : state === AppState.END ? uiTokens.backdrop.end : state === AppState.RESULT ? uiTokens.backdrop.result : uiTokens.backdrop.content
    this.addArenaBackdrop(container, darkness)
  }

  private addArenaBackdrop(container: Phaser.GameObjects.Container, darkness: number, stageId = this.selectedStageId): void {
    const cover = aspectCover(2752, 1536, uiTokens.logicalWidth, uiTokens.logicalHeight)
    const backdrop = this.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(stageId)).setDisplaySize(cover.width, cover.height)
    container.add(backdrop)
    if (container === this.screen) this.stageBackdrop = backdrop
    this.addAtmosphere(container, darkness)
  }
  private addAtmosphere(container: Phaser.GameObjects.Container, darkness: number): void {
    container.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, darkness))
    const atmosphere = this.add.graphics()
    atmosphere.fillGradientStyle(uiTokens.colors.playerPrimary, uiTokens.colors.background0, uiTokens.colors.enemyPrimary, uiTokens.colors.background0, 0.1, 0, 0.08, 0).fillRect(0, 0, 1920, 1080)
    atmosphere.fillGradientStyle(uiTokens.colors.background0, uiTokens.colors.background0, uiTokens.colors.background0, uiTokens.colors.background1, uiTokens.opacity.vignette, uiTokens.opacity.vignette, 0, 0).fillRect(0, 0, 1920, 170)
    atmosphere.fillGradientStyle(uiTokens.colors.background1, uiTokens.colors.background0, uiTokens.colors.background0, uiTokens.colors.background0, 0, 0, uiTokens.opacity.vignette, uiTokens.opacity.vignette).fillRect(0, 900, 1920, 180)
    atmosphere.fillStyle(uiTokens.colors.playerGlow, 0.05).fillEllipse(0, 540, 620, 980)
    atmosphere.fillStyle(uiTokens.colors.enemyGlow, 0.05).fillEllipse(1920, 540, 620, 980)
    container.add(atmosphere)
  }
  private heading(text: string, x = 110, y = 112): Phaser.GameObjects.Text { return this.add.text(x, y, text, typography.heading).setOrigin(0, 0.5) }
  private label(text: string, x: number, y: number, size: number = uiTokens.type.body, color = colorHex('textSecondary')): Phaser.GameObjects.Text { return this.add.text(x, y, text, { ...typography.note, fontSize: size, color }).setOrigin(0.5) }
  private register(group: string, id: string, object: Focusable, activate: () => void, enabled = true): void {
    this.buttons.set(id, object); this.ui.focus.register(group, id, enabled, activate)
    object.on('pointerover', () => { if (object.input?.enabled && this.ui.focus.current() !== id) this.ui.focus.activate(group, id) })
  }
  private addScreenTween(config: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween | undefined { if (reducedMotion && config.repeat === -1) return; const tween = this.tweens.add(reducedMotion ? { ...config, duration: 0, delay: 0 } : config); this.screenTweens.push(tween); tween.once('complete', () => { const index = this.screenTweens.indexOf(tween); if (index >= 0) this.screenTweens.splice(index, 1) }); return tween }

  /** P0 只有場景背景、START 與提示；排行在遊玩後的 P6／P7 呈現。 */
  private renderP0(): void {
    const start = new ActionButton(this, 'START', 420, 100, uiTokens.colors.playerPrimary, '開始遊戲').setPosition(740, 860)
    const board = new ActionButton(this, 'BOARD', 420, 100, uiTokens.colors.panelRaised, '排行榜').setPosition(1180, 860)
    const begin = (): void => { this.appStateMachine.transitionTo(AppState.READY) }
    start.on('pointerup', begin); board.on('pointerup', () => this.openBoard())
    this.screen?.add([start, board]); this.register('p0', 'p0-start', start, begin); this.register('p0', 'p0-board', board, () => this.openBoard()); this.ui.focus.activate('p0', 'p0-start')
    this.screen?.add(this.label('ENTER 確認 · ← → 切換 · P 播放開頭動畫 · C 操作設定', 960, 960, uiTokens.type.label))
  }
  /** 首頁排行榜：開啟時才查詢；回應晚於關閉（序號不符）即丟棄。 */
  private openBoard(): void {
    if (this.boardPanel) return
    const request = ++this.boardRequest, panel = new LeaderboardPanel(this, leaderboardPanelModel(undefined), () => this.closeBoard())
    this.boardPanel = panel
    if (!this.persistence) { panel.update(leaderboardPanelModel([], false)); return }
    void this.persistence.leaderboard(10).then((entries) => { if (request === this.boardRequest && this.boardPanel === panel) panel.update(leaderboardPanelModel(entries, this.persistence?.lastLeaderboardOk !== false)) })
  }
  private closeBoard(refocus = true): void {
    if (!this.boardPanel) return
    this.boardRequest += 1; this.boardPanel.destroy(); this.boardPanel = undefined; this.noteActivity()
    if (refocus && this.appStateMachine.getCurrentState() === AppState.IDLE) this.ui.focus.activate('p0', 'p0-board')
  }

  private addBackButton(group: string): void {
    const back = new ActionButton(this, 'BACK', 270, 88, uiTokens.colors.panelRaised, '返回').setPosition(245, 952)
    back.on('pointerup', () => this.ui.navigation.dispatch('BACK'))
    this.screen?.add(back); this.register(group, group + '-back', back, () => this.ui.navigation.dispatch('BACK'))
  }

  private renderP1(): void {
    this.p1Model ??= new P1SelectionModel()
    this.p1View = new P1SelectView(this, this.screen as Phaser.GameObjects.Container, this.p1Model, {
      offline: this.p1Offline || this.persistence?.lastLeaderboardOk === false,
      onInput: (owner, action) => this.p1Input(owner, action),
      onFocus: (owner, index) => { if (this.p1Model?.focus(owner, index)) this.p1View?.sync() },
      onNickname: (owner, name) => { this.p1Model?.setNickname(owner, name); this.lastActivity = this.time.now },
      onProcessingDone: () => { this.p1Model?.completeProcessing(); this.syncP1() },
      onAllReady: () => this.confirmPlayers(),
    })
  }
  private p1Input(owner: PlayerSlotId, action: OwnedUiAction): void {
    if (this.p1View?.exitOpen) return
    this.noteActivity()
    this.p1View?.captureOnConfirm(owner, action)
    const feedback = this.p1Model?.input(owner, action)
    if (feedback) this.p1View?.feedback(owner, feedback)
    this.syncP1()
  }
  /** Customize 各步驟是 P1 substate：切換時整頁重建，其餘只同步常駐物件。 */
  private syncP1(): void {
    const phase: P1Phase = this.p1Model?.phase ?? 'GRID'
    const substate = phase === 'GRID' || phase === 'ALL_READY' ? 'READY' : phase === 'FAILED' ? 'FALLBACK' : phase
    if (!this.ui.substates.set(AppState.READY, substate)) this.p1View?.sync()
  }
  private confirmPlayers(): void {
    const players = this.p1Model?.result() ?? {}
    if (!players.P1 || this.showcaseState || this.p1Model?.phase !== 'ALL_READY') return
    this.players = players; this.selectedCharacterId = players.P1.characterId
    this.persistence?.context.set({ selectedCharacterId: players.P1.characterId, players })
    void this.persistence?.updateSession(this.selectedCharacterId).catch(() => undefined)
    this.appStateMachine.transitionTo(AppState.SETUP)
  }
  private checkIdle(now: number): void {
    if (this.showcaseState || !this.lastActivity) return
    const state = this.appStateMachine.getCurrentState(), idle = now - this.lastActivity, { idleMs } = uiTokens.p1
    if (state === AppState.IDLE) { if (!this.attract && !this.controlsPanel && !this.boardPanel && idle >= idleMs.attract) this.playAttract(); return }
    const phase = this.p1Model?.phase
    const limit = state === AppState.END ? idleMs.end : state === AppState.READY ? phase === 'GRID' ? idleMs.select : phase === 'CUSTOMIZE' || phase === 'REVIEW' || phase === 'FAILED' ? idleMs.customize : 0 : 0
    if (!limit) { this.idleLabel?.setText(''); return }
    if (!this.idleLabel) { this.idleLabel = this.label('', 960, 42, uiTokens.type.label, colorHex('resultGold')); this.screen?.add(this.idleLabel) }
    this.idleLabel.setText(idle >= limit - 10000 ? `閒置倒數 ${Math.max(0, Math.ceil((limit - idle) / 1000))}s · 操作以繼續` : '')
    if (idle < limit) return
    this.noteActivity()
    if (state === AppState.READY && this.p1Model?.owner) { this.p1Model.abortCustomize(); this.syncP1() }
    else this.ui.navigation.dispatch('FINISH')
  }

  /** 進入 P2：1P 先選對手（OPPONENT），2P 直接選場景。Replay 沿用上次對手與難度。 */
  private enterSetup(): void {
    const solo = !this.players.P2
    this.opponentModel = solo ? new OpponentSelectModel(undefined, this.selectedCharacterId, this.opponent) : undefined
    this.ui.substates.set(AppState.SETUP, solo ? 'OPPONENT' : 'DEFAULT')
  }
  /** P2 內的 BACK：已選對手先取消；場景退回選對手（保留選擇）；其餘交給 declared route。 */
  private handleSetupBack(): boolean {
    if (this.appStateMachine.getCurrentState() !== AppState.SETUP || !this.opponentModel) return false
    if (this.ui.substates.get(AppState.SETUP) === 'DEFAULT') { this.ui.substates.set(AppState.SETUP, 'OPPONENT'); return true }
    if (!this.opponentModel.cancel()) return false
    this.render(AppState.SETUP); return true
  }
  private renderOpponent(): void {
    const model = this.opponentModel; if (!model) return
    this.screen?.add(this.heading('SELECT OPPONENT')); this.screen?.add(this.add.text(110, 174, `${this.stepTotal() - 1} / ${this.stepTotal()} ・ 選擇對手與難度 · 已選的對手可按返回取消重選`, typography.instruction))
    const columns = 5, cardW = 300, cardH = 150
    model.candidates.forEach((entry, i) => {
      const locked = model.locked?.id === entry.id
      const card = new ActionButton(this, entry.displayName, cardW, cardH, locked ? uiTokens.colors.enemyPrimary : uiTokens.colors.panelRaised, locked ? 'LOCKED ・ 已選' : entry.type === 'BODY_TEMPLATE' ? 'CUSTOM BODY' : entry.type)
        .setPosition(320 + (i % columns) * (cardW + 20), 330 + Math.floor(i / columns) * (cardH + 20))
      const pick = (): void => { model.select(i); this.render(AppState.SETUP); this.ui.focus.activate('opponent', 'opp-next') }
      card.on('pointerup', pick); this.screen?.add(card); this.register('opponent', `opp-card-${i}`, card, pick)
    })
    const difficulty = new ActionButton(this, `難度 ◀ ${model.difficulty} ▶`, 520, 88, uiTokens.colors.panelRaised, 'DIFFICULTY ・ 確認鍵切換').setPosition(960, 952)
    const cycle = (): void => { model.cycleDifficulty(); this.render(AppState.SETUP); this.ui.focus.activate('opponent', 'opp-difficulty') }
    difficulty.on('pointerup', cycle); this.screen?.add(difficulty); this.register('opponent', 'opp-difficulty', difficulty, cycle)
    const next = new ActionButton(this, 'NEXT', 350, 88, uiTokens.colors.playerPrimary, '下一步').setPosition(1610, 952).setEnabled(model.canProceed())
    const proceed = (): void => { const choice = model.result(); if (!choice) return; this.opponent = choice; this.ui.substates.set(AppState.SETUP, 'DEFAULT') }
    next.on('pointerup', proceed); this.screen?.add(next); this.register('opponent', 'opp-next', next, proceed, model.canProceed())
    this.addBackButton('opponent')
    this.ui.focus.activate('opponent', model.canProceed() ? 'opp-next' : `opp-card-${model.cursor}`)
  }
  private renderP2(): void {
    if (this.ui.substates.get(AppState.SETUP) === 'OPPONENT' && this.opponentModel) { this.renderOpponent(); return }
    const vm = stageSelectViewModel(this.selectedStageId)
    this.screen?.add(this.heading(vm.heading)); this.screen?.add(this.add.text(110, 174, `${this.stepTotal()} / ${this.stepTotal()}` + ' ・ 選擇對戰場景', typography.instruction))
    vm.stages.forEach((stage, index) => {
      const card = new StageCard(this, stage.label, stageTextureKey(stage.id), 780, 500, stage.id === 'laboratory' ? '實驗室' : '企業總部').setPosition(530 + index * 860, 550).setSelected(stage.id === vm.selectedStageId)
      const pick = (): void => { this.selectStage(stage.id, true); this.ui.focus.activate('stage', 'stage-confirm') }
      card.setInteractive({ useHandCursor: true }).on('pointerup', pick); this.screen?.add(card); this.register('stage', `stage-${stage.id}`, card, pick)
    })
    this.addBackButton('stage')
    const confirm = new ActionButton(this, 'CONFIRM', 350, 88, uiTokens.colors.playerPrimary, '確認').setPosition(1610, 952)
    confirm.on('pointerup', () => this.confirmStage()); this.screen?.add(confirm); this.register('stage', 'stage-confirm', confirm, () => this.confirmStage()); this.ui.focus.activate('stage', `stage-${vm.selectedStageId}`)
  }
  private selectStage(id: StageId, update = false): void {
    this.selectedStageId = id; this.persistence?.context.set({ selectedStageId: id })
    if (!update) return
    this.stageBackdrop?.setTexture(stageTextureKey(id))
    document.body.style.setProperty('--backdrop', `url("${resolveStageAsset(id).url}")`)
    this.buttons.forEach((card, key) => { if (card instanceof StageCard) card.setSelected(key === `stage-${id}`) })
  }
  private confirmStage(): void { this.selectStage(this.selectedStageId); this.appStateMachine.transitionTo(AppState.LOADING) }

  private renderP3(): void {
    const vm = loadingViewModel(this.playerEntry(), this.enemyName(), resolveStageAsset(this.selectedStageId).label, 1, this.playerName())
    const root = this.screen as Phaser.GameObjects.Container
    addFocalGlow(this, root, 430, 370, 850, 780, uiTokens.colors.playerPrimary, uiTokens.glowAlpha.player)
    addFocalGlow(this, root, 1480, 370, 850, 780, uiTokens.colors.enemyPrimary, uiTokens.glowAlpha.enemy)
    root.add(this.add.graphics().lineStyle(8, uiTokens.colors.systemBlue, 0.4).lineBetween(1100, 0, 820, 710))
    const playerFallback = fighterSilhouette(this, 430, 340, 480, 600, uiTokens.colors.playerPrimary, 0.4)
    const enemyFallback = fighterSilhouette(this, 1480, 340, 480, 600, uiTokens.colors.enemyPrimary, 0.4)
    root.add([playerFallback, enemyFallback])
    this.addCharacterPreview(root, vm.character.spriteId, vm.character.previewUrl, 430, 360, 560, 700, playerFallback)
    this.addCharacterPreview(root, this.enemySpriteId(), undefined, 1480, 360, 560, 700, enemyFallback)?.setFlipX(true)
    root.add(this.add.text(130, 565, 'PLAYER', { ...typography.note, color: colorHex('playerGlow') }))
    root.add(this.add.text(130, 600, vm.playerName, typography.title))
    if (vm.character.type === 'BODY_TEMPLATE') root.add(this.add.text(130, 680, vm.character.displayName + ' · TEMP BODY', { ...typography.note, color: colorHex('resultGold') }))
    root.add(this.add.text(1780, 565, this.players.P2 ? 'ENEMY · 2P · CPU' : 'ENEMY · CPU', { ...typography.note, color: colorHex('enemyGlow') }).setOrigin(1, 0))
    root.add(this.add.text(1780, 600, vm.enemyName, typography.title).setOrigin(1, 0))
    root.add(this.add.text(960, 330, 'VS', { ...typography.title, fontSize: uiTokens.type.hero, stroke: colorHex('systemBlue'), strokeThickness: 8 }).setOrigin(0.5).setRotation(-0.08))
    root.add(this.label(vm.stage, 960, 670, uiTokens.type.body))
    const controls = new AngularPanel(this, 1030, 294, uiTokens.colors.panelRaised).setPosition(620, 865)
    controls.add(this.add.text(-465, -120, 'CONTROLS ・ 操作說明', typography.secondaryAction))
    const key = (...actions: CombatAction[]): string => actions.map((action) => keyLabel(this.controls.P1[action])).join(' ')
    controls.add(this.add.text(475, -112, `${key('GUARD')} 防禦 · ${key('CROUCH')} 蹲 · ${key('PAUSE')} 暫停`, typography.note).setOrigin(1, 0))
    const bindings = [['MOVE', key('MOVE_LEFT', 'MOVE_RIGHT', 'MOVE_UP', 'MOVE_DOWN'), 'D-PAD / L-STICK'], ['JUMP', key('JUMP'), 'A'], ['PUNCH', key('LIGHT_PUNCH', 'HEAVY_PUNCH'), 'X Y'], ['KICK', key('LIGHT_KICK', 'HEAVY_KICK'), 'LB RB']]
    bindings.forEach(([action, keyboard, pad], i) => {
      const x = -455 + (i % 2) * 500, y = -25 + Math.floor(i / 2) * 104
      controls.add(this.add.text(x, y - 35, action, typography.note))
      const keyboardCap = new KeyCap(this, keyboard, 'keyboard').setPosition(x + 90, y + 15)
      const padCap = new KeyCap(this, pad, 'gamepad').setPosition(x + 320, y + 15)
      controls.add([keyboardCap, padCap]); this.keyCaps.push(keyboardCap, padCap)
    })
    root.add(controls)
    const loading = new AngularPanel(this, 640, 294, uiTokens.colors.panelRaised).setPosition(1495, 865)
    loading.add(this.add.text(-260, -120, 'LOADING ・ 載入中', typography.secondaryAction))
    loading.add(this.add.rectangle(0, -40, 520, 14, uiTokens.colors.background0))
    this.loadingBar = this.add.rectangle(-260, -40, 520, 14, uiTokens.colors.systemBlue).setOrigin(0, 0.5)
    this.loadingPercent = this.add.text(260, -82, '', typography.note).setOrigin(1, 0.5)
    this.loadingButton = new ActionButton(this, 'FIGHT!', 440, 92, uiTokens.colors.playerPrimary, 'ENTER / A ・ 開始').setPosition(0, 55).setEnabled(false)
    const fight = (): void => { if (this.loadingReady) this.appStateMachine.transitionTo(AppState.BATTLE) }
    this.loadingButton.on('pointerup', fight); loading.add([this.loadingBar, this.loadingPercent, this.loadingButton]); root.add(loading)
    this.register('loading', 'loading-fight', this.loadingButton, fight, false); this.updateLoading()
  }
  private updateLoading(): void {
    if (!this.loadingButton) return
    const boot = this.scene.get('BootScene').load
    const busy = boot.isLoading() || this.load.isLoading()
    const progress = busy ? (this.load.isLoading() ? this.load.progress : boot.progress) : 1
    this.loadingBar?.setScale(progress, 1); this.loadingPercent?.setText(busy ? Math.round(progress * 100) + '%' : 'READY')
    if (this.loadingReady !== !busy) {
      this.loadingReady = !busy; this.loadingButton.setEnabled(!busy); this.ui.focus.setEnabled('loading', 'loading-fight', !busy)
      this.loadingPulse?.stop(); this.loadingButton.label.setAlpha(1)
      if (!busy) { this.ui.focus.activate('loading', 'loading-fight'); this.loadingPulse = this.addScreenTween({ targets: this.loadingButton.label, alpha: 0.7, duration: 700, yoyo: true, repeat: -1 }) }
    }
    const device = this.inputManager.lastDevice()
    if (device !== this.promptDevice) { this.promptDevice = device; this.keyCaps.forEach(cap => cap.setEmphasis(cap.device === device)) }
  }

  private renderP4(): void {
    const root = this.battleRoot = this.add.container(0, 0); this.screen?.add(root)
    const world = this.addBattleStage(root, uiTokens.backdrop.battle)
    this.battlePlayer = new TemporarySpriteRenderer(this, this.playerSpriteId(), uiTokens.colors.playerPrimary, this.match.world.getConfig().floorY)
    this.battleEnemy = new TemporarySpriteRenderer(this, this.enemySpriteId(), uiTokens.colors.enemyPrimary, this.match.world.getConfig().floorY)
    world.add([this.battlePlayer, this.battleEnemy])
    this.battlePlayerBar = new HealthBar(this, 560, uiTokens.colors.playerPrimary).setPosition(230, 112)
    this.battleEnemyBar = new HealthBar(this, 560, uiTokens.colors.enemyPrimary, true).setPosition(1130, 112)
    this.battlePlayerRounds = new RoundDiamonds(this).setPosition(250, 156)
    this.battleEnemyRounds = new RoundDiamonds(this, true).setPosition(1670, 156)
    root.add([this.battlePlayerBar, this.battleEnemyBar, this.battlePlayerRounds, this.battleEnemyRounds])
    ;[[150, this.playerSpriteId(), uiTokens.colors.playerPrimary], [1770, this.enemySpriteId(), uiTokens.colors.enemyPrimary]].forEach(([x, sprite, color]) => {
      const portrait = new AngularPanel(this, 100, 100, Number(color)).setPosition(Number(x), 108)
      const key = sprite && spriteTextureKey(sprite as SpriteId, 'idle')
      portrait.add(key && this.textures.exists(key) ? this.add.image(0, 0, key, spriteTextureFrame(sprite as SpriteId | undefined)).setDisplaySize(96, 96) : fighterSilhouette(this, 0, 0, 65, 75, Number(color), 0.7)); root.add(portrait)
    })
    root.add(this.add.text(230, 62, this.playerName(), typography.secondaryAction))
    root.add(this.add.text(1690, 62, this.enemyName(), typography.secondaryAction).setOrigin(1, 0))
    root.add(this.add.text(1690, 36, this.players.P2 ? '2P · CPU' : 'CPU', { ...typography.note, color: colorHex('enemyGlow') }).setOrigin(1, 0))
    this.battleTimer = new HexTimer(this).setPosition(960, 110); root.add(this.battleTimer)
    this.battleCombo = this.add.text(380, 166, '', typography.combo).setOrigin(0, 0.5)
    this.battleDanger = this.add.text(1550, 166, '', typography.danger).setOrigin(1, 0.5)
    this.battleLastTen = this.add.text(1130, 166, '', { ...typography.note, color: colorHex('danger') }).setOrigin(0, 0.5)
    this.battleFirstAttack = this.add.text(710, 166, 'FIRST ATTACK!', { ...typography.note, color: colorHex('statusLime') }).setOrigin(0.5).setVisible(false)
    this.battleBanner = new RoundBanner(this)
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('inputDebug') === '1') { this.inputDebug = this.add.text(40, 820, '', { ...typography.note, color: colorHex('statusLime'), backgroundColor: '#000000cc', padding: { x: 12, y: 8 } }); root.add(this.inputDebug) }
    root.add([this.battleCombo, this.battleDanger, this.battleLastTen, this.battleFirstAttack, this.battleBanner])
  }
  /** 圖層：影片／背景 → 暗化氣氛 → 角色 world（0.9）→ 地板前景 → HUD（呼叫端之後加入）。 */
  private addBattleStage(root: Phaser.GameObjects.Container, darkness: number): Phaser.GameObjects.Container {
    const back = this.add.container(), front = this.add.container()
    this.stage = new StageParallax(this, this.selectedStageId, reducedMotion, back, front)
    root.add(back); this.addAtmosphere(root, darkness)
    this.battleWorld = this.add.container(0, 82).setScale(WORLD_ZOOM)
    root.add([this.battleWorld, front]); this.placeWorld()
    return this.battleWorld
  }
  private placeWorld(): void {
    this.battleWorld?.setX(worldX(this.stageScroll))
    this.stage?.move(this.stageScroll)
  }
  private updateBattle(snapshot: MatchSnapshot): void {
    if (!this.battleRoot || !this.battlePlayer || !this.battleEnemy) return
    const source = battleViewModel(snapshot, this.selectedStageId, this.playerName(), this.enemyName())
    const vm = this.showcaseState === AppState.BATTLE ? { ...source, combo: this.showcaseBattleVariant === 'COMBO' ? 4 : source.combo, danger: this.showcaseBattleVariant === 'DANGER' || source.danger, lastTenSeconds: this.showcaseBattleVariant === 'LAST_10_SECONDS' || source.lastTenSeconds, timerSeconds: this.showcaseBattleVariant === 'LAST_10_SECONDS' ? 10 : source.timerSeconds } : source
    const tick = snapshot.world.tick, hit = this.tickEvents.splice(0).find(e => e.type === 'HIT')
    if (hit?.type === 'HIT' && this.firstHit?.round !== vm.round) this.firstHit = { round: vm.round, tick, byPlayer: hit.attacker === 'PLAYER' }
    this.battlePlayer.update(vm.player, tick, this.playerContext); this.battleEnemy.update(vm.enemy, tick)
    this.battleWorld?.bringToTop(vm.player.z <= vm.enemy.z ? this.battlePlayer : this.battleEnemy) // 縱深較前者畫在上層
    if (this.inputDebug) this.updateInputDebug(vm.player)
    this.battlePlayerBar?.setRatio(vm.playerHp / vm.maxHp, vm.playerHp); this.battleEnemyBar?.setRatio(vm.enemyHp / vm.maxHp, vm.enemyHp)
    this.battlePlayerRounds?.setWins(vm.playerWins); this.battleEnemyRounds?.setWins(vm.enemyWins); this.battleTimer?.updateTime(vm.timerSeconds, vm.round)
    this.battleCombo?.setText(vm.combo >= 2 ? `${vm.combo} COMBO` : ''); this.battleDanger?.setText(vm.danger ? 'DANGER' : '')
    this.battleLastTen?.setText(vm.lastTenSeconds ? '10 SECONDS!' : '')
    this.battleFirstAttack?.setVisible(Boolean(this.firstHit?.byPlayer && this.firstHit.round === vm.round && tick >= this.firstHit.tick && tick < this.firstHit.tick + 24))
    // 起手序列由 MatchController.introPhase 驅動；DEV showcase 仍用原本的計時步驟。
    if (snapshot.introPhase) this.battleBanner?.setText(snapshot.introPhase === 'ROUND' ? `ROUND ${snapshot.roundNumber}` : snapshot.introPhase === 'READY' ? 'READY?' : 'FIGHT!')
    else if (this.showcaseState) {
      const steps = roundBannerSequence(this.previousBattle, snapshot)
      if (steps) this.battleBanner?.show(steps, this.clock.getTick())
      this.battleBanner?.updateTick(this.clock.getTick())
    } else this.battleBanner?.setText('')
    this.previousBattle = snapshot
    if (this.showcaseState && !this.showcaseAnnouncer) this.battleBanner?.setVisible(false)
  }

  private renderP5(): void {
    const vm = presentationViewModel(this.resolvedResult, this.showcaseState === AppState.PRESENTATION ? this.showcaseP5Variant : undefined)
    this.battleRoot = this.add.container(0, 0); this.screen?.add(this.battleRoot); const world = this.addBattleStage(this.battleRoot, uiTokens.backdrop.presentation)
    const snapshot = this.match.getSnapshot()
    this.battlePlayer = new TemporarySpriteRenderer(this, this.playerSpriteId(), uiTokens.colors.playerPrimary, this.match.world.getConfig().floorY)
    this.battlePlayer.update(snapshot.world.fighters.PLAYER, snapshot.world.tick)
    this.battleEnemy = new TemporarySpriteRenderer(this, this.enemySpriteId(), uiTokens.colors.enemyPrimary, this.match.world.getConfig().floorY)
    this.battleEnemy.update(snapshot.world.fighters.ENEMY, snapshot.world.tick)
    world.add([this.battlePlayer, this.battleEnemy])
    this.battleRoot.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.backdrop.impact))
    addFocalGlow(this, this.battleRoot, 960, 470, 1120, 450, uiTokens.colors.danger, uiTokens.glowAlpha.result)
    addFocalGlow(this, this.battleRoot, 960, 470, 760, 310, uiTokens.colors.resultGold, uiTokens.glowAlpha.gold)
    const rays = this.add.graphics().setPosition(960, 450)
    for (let i = 0; i < 26; i += 1) { const angle = i * Math.PI * 2 / 26; rays.fillStyle(uiTokens.colors.playerPrimary, 0.1).fillTriangle(0, 0, Math.cos(angle) * 1500, Math.sin(angle) * 1500, Math.cos(angle + 0.04) * 1500, Math.sin(angle + 0.04) * 1500) }
    this.battleRoot.add(rays); this.addScreenTween({ targets: rays, angle: 360, duration: 12000, repeat: -1 })
    if (!reducedMotion) this.cameras.main.shake(300, 0.006)
    const impact = this.add.graphics()
    impact.lineStyle(20, uiTokens.colors.danger, 0.46).lineBetween(465, 610, 1455, 315)
    impact.lineStyle(6, uiTokens.colors.resultGold, 0.62).lineBetween(520, 635, 1405, 370)
    impact.lineStyle(3, uiTokens.colors.playerGlow, 0.38).lineBetween(580, 660, 1320, 410)
    this.battleRoot.add(impact)
    if (vm.headline) {
      const ko = this.add.text(960, 330, vm.headline, { ...typography.announcer, fontSize: uiTokens.type.hero, color: colorHex('resultGold'), stroke: colorHex(this.game.renderer.type === Phaser.WEBGL ? 'background0' : 'danger'), strokeThickness: uiTokens.textStroke.impact, shadow: { color: colorHex('danger'), blur: uiTokens.shadowBlur.impact, fill: true } }).setOrigin(0.5).setRotation(-0.045).setScale(0.86).setAlpha(0)
      if (this.game.renderer.type === Phaser.WEBGL) ko.postFX.addGradient(uiTokens.colors.resultGold, uiTokens.colors.danger, 0.72, 0, 0, 0, 1)
      this.screen?.add(ko)
      this.addScreenTween({ targets: ko, scale: 1, alpha: 1, duration: uiTokens.motionMs.announcer, ease: 'Back.Out' })
    }
    if (vm.outcome) {
      const semantic = vm.result === 'WIN' ? colorHex('playerGlow') : vm.result === 'DRAW' ? colorHex('systemBlue') : colorHex('textSecondary')
      this.screen?.add(this.add.text(960, 530, vm.outcome, { ...typography.action, fontSize: uiTokens.type.h2, color: semantic, shadow: vm.result === 'WIN' ? { color: colorHex('danger'), blur: uiTokens.shadowBlur.semantic, fill: true } : undefined }).setOrigin(0.5))
    }
    this.match.getRoundSummaries().forEach((round, index, rounds) => {
      const panel = new AngularPanel(this, 210, 100, round.winner === 'PLAYER' ? uiTokens.colors.playerPrimary : round.winner === 'ENEMY' ? uiTokens.colors.enemyPrimary : uiTokens.colors.panelRaised).setPosition(960 + (index - (rounds.length - 1) / 2) * 230, 700)
      panel.add(this.label('ROUND ' + round.roundNumber, 0, -22, uiTokens.type.label))
      panel.add(this.add.text(0, 18, round.winner === 'PLAYER' ? 'WIN' : round.winner === 'ENEMY' ? 'LOSE' : 'DRAW', typography.action).setOrigin(0.5)); this.screen?.add(panel)
    })
    if (this.resolvedResult || this.showcaseState) {
      const next = new ActionButton(this, 'VIEW RESULTS', 420, 96, uiTokens.colors.playerPrimary, '查看結算').setPosition(960, 952)
      next.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.RESULT))
      this.screen?.add(next); this.register('presentation', 'presentation-next', next, () => this.appStateMachine.transitionTo(AppState.RESULT)); this.ui.focus.activate('presentation')
    }
  }

  private renderP6(): void {
    if (import.meta.env.DEV && this.showcaseState) this.renderResultColumns(mockResultViewModel(this.showcaseP6SubState))
    else if (this.resolvedResult) this.renderResultColumns(resultViewModel(this.resolvedResult, this.persistence?.context.snapshot.backendRank ?? null, p6SubStateForRank(this.persistence?.context.snapshot.backendRank), this.leaderboardEntries, this.persistence?.context.snapshot.sessionId))
  }

  private renderResultColumns(vm: ResultViewModel): void {
    this.screen?.add(this.heading('MATCH RESULT'))
    const columns = [{ x: 353, w: 514, title: 'STATISTICS' }, { x: 960, w: 644, title: 'RESULT' }, { x: 1567, w: 514, title: 'RANKING' }]
    const panels = columns.map(({ x, w, title }) => {
      const height = title === 'STATISTICS' ? Math.min(640, 150 + vm.statistics.length * 88) : 640
      const panel = new AngularPanel(this, w, height, uiTokens.colors.panelRaised).setPosition(x, 230 + height / 2)
      panel.add(this.add.text(-w / 2 + 32, -height / 2 + 45, title, typography.secondaryAction).setOrigin(0, 0.5))
      panel.add(this.add.rectangle(0, -height / 2 + 100, w - 52, 1, uiTokens.colors.lineDim, 0.9))
      this.screen?.add(panel)
      return panel
    })
    const [statistics, result, ranking] = panels
    const statStep = Math.min(88, 480 / Math.max(1, vm.statistics.length))
    vm.statistics.forEach((stat, index) => {
      const y = -statistics.height / 2 + 145 + index * statStep
      statistics.add(this.add.text(-215, y, stat.label, { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('textSecondary') }).setOrigin(0, 0.5))
      statistics.add(this.add.text(215, y, String(stat.value), { ...typography.number, fontSize: uiTokens.type.body }).setOrigin(1, 0.5))
      statistics.add(this.add.rectangle(0, y + statStep / 2, 450, 1, uiTokens.colors.lineDim, 0.65))
    })
    const win = vm.outcome === 'WIN'
    const headlineColor = win ? colorHex('playerGlow') : vm.outcome === 'DRAW' ? colorHex('systemBlue') : colorHex('textSecondary')
    addFocalGlow(this, result, 0, -150, 520, 260, win ? uiTokens.colors.playerPrimary : uiTokens.colors.systemBlue, win ? uiTokens.glowAlpha.win : uiTokens.glowAlpha.subtle)
    const headline = this.add.text(0, -170, vm.headline, { ...typography.announcer, fontSize: uiTokens.type.h1, color: headlineColor, stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.result, shadow: win ? { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.focal, fill: true } : undefined }).setOrigin(0.5).setScale(0.88).setAlpha(0)
    result.add(headline)
    this.addScreenTween({ targets: headline, scale: 1, alpha: 1, duration: uiTokens.motionMs.focalReveal, ease: 'Cubic.Out' })
    if (vm.title) result.add(new AngularPanel(this, 530, 62, uiTokens.colors.resultGold, 1).setPosition(0, -38))
    const title = this.add.text(0, -38, vm.title, { ...typography.secondaryAction, fontSize: uiTokens.type.title, color: colorHex('background0') }).setOrigin(0.5).setAlpha(0)
    const scoreLabel = this.add.text(0, 40, 'SCORE', { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    const score = this.add.text(0, 120, String(vm.score), { ...typography.number, fontSize: uiTokens.type.display }).setOrigin(0.5).setAlpha(0)
    const rank = this.add.text(0, 207, 'RANK  ' + (vm.rank ?? 'NOT RANKED'), { ...typography.note, fontSize: uiTokens.type.body, color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    result.add([title, scoreLabel, score, rank])
    this.addScreenTween({ targets: [title, scoreLabel, score, rank], alpha: 1, duration: 160, delay: 100, ease: 'Cubic.Out' })
    if (vm.newRecord) {
      const badge = this.add.text(0, 278, 'NEW RECORD', { ...typography.secondaryAction, fontSize: uiTokens.type.title, color: colorHex('resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.badge, shadow: { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.subtle, fill: true } }).setOrigin(0.5).setAlpha(0)
      result.add(badge)
      this.addScreenTween({ targets: badge, alpha: 1, duration: 160, delay: 240, ease: 'Cubic.Out' })
    }
    const rowSpacing = Math.min(46, 460 / Math.max(1, Math.min(20, vm.ranking.length)))
    vm.ranking.slice(0, 20).forEach((row, index) => {
      const y = -180 + index * rowSpacing
      if (row.highlighted) ranking.add(this.add.rectangle(0, y, 460, rowSpacing - 4, uiTokens.colors.playerPrimary, 0.24))
      ranking.add(this.add.rectangle(0, y + rowSpacing / 2, 462, 1, uiTokens.colors.lineDim, 0.66))
      if (row.highlighted) ranking.add(this.add.rectangle(-227, y, 4, rowSpacing - 4, uiTokens.colors.playerGlow, 0.95))
      ranking.add(this.add.text(-210, y, String(row.rank).padStart(2, '0') + '  ' + row.name, { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('textPrimary') }).setOrigin(0, 0.5))
      ranking.add(this.add.text(210, y, String(row.score), { ...typography.number, fontSize: uiTokens.type.label, color: row.highlighted ? colorHex('textPrimary') : colorHex('textSecondary') }).setOrigin(1, 0.5))
    })
    if (this.resolvedResult || this.showcaseState) {
      const next = new ActionButton(this, 'CONTINUE', 380, 88, uiTokens.colors.playerPrimary, '繼續').setPosition(960, 952)
      next.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.END))
      this.screen?.add(next); this.register('result', 'result-next', next, () => this.appStateMachine.transitionTo(AppState.END)); this.ui.focus.activate('result')
    }
  }

  private renderP7(): void {
    const vm = endViewModel(this.nextPlayerName)
    addFocalGlow(this, this.screen as Phaser.GameObjects.Container, 960, 515, 900, 560, uiTokens.colors.systemBlue, uiTokens.glowAlpha.ambient)
    const panel = new AngularPanel(this, 900, 500, uiTokens.colors.panelRaised).setPosition(960, 500)
    panel.add(this.add.text(0, -170, 'PLAY AGAIN?', typography.title).setOrigin(0.5))
    panel.add(this.add.text(0, -112, '再戰一場（重新選擇場景）', typography.instruction).setOrigin(0.5))
    const replay = new ActionButton(this, 'PLAY AGAIN', 470, 96).setPosition(0, -6)
    const finish = new ActionButton(this, 'FINISH', 470, 86, uiTokens.colors.background1).setPosition(0, 132)
    replay.setInteractive({ useHandCursor: true }).on('pointerup', () => this.ui.navigation.dispatch('REPLAY'))
    finish.setInteractive({ useHandCursor: true }).on('pointerup', () => this.ui.navigation.dispatch('FINISH'))
    panel.add([replay, finish]); this.screen?.add(panel)
    this.register('end', 'play-again', replay, () => this.ui.navigation.dispatch('REPLAY'))
    this.register('end', 'finish', finish, () => this.ui.navigation.dispatch('FINISH'))
    this.ui.focus.activate('end', 'play-again')
    if (vm.nextPlayerName) {
      const next = new AngularPanel(this, 430, 190, uiTokens.colors.panelRaised).setPosition(960, 885)
      next.add(this.add.text(-180, -63, 'NEXT', { ...typography.secondaryAction, fontSize: uiTokens.type.body, color: colorHex('systemBlue') }).setOrigin(0, 0.5))
      next.add(fighterSilhouette(this, -125, 35, 116, 128, uiTokens.colors.enemyPrimary, 0.42))
      next.add(this.add.text(-60, 34, vm.nextPlayerName, { ...typography.secondaryAction, fontSize: uiTokens.type.body }).setOrigin(0, 0.5))
      this.screen?.add(next)
    }
  }
  private installShowcaseKeys(): void {
    const bind = (event: string, listener: () => void): void => { this.input.keyboard?.on(event, listener); this.showcaseListeners.push({ event, listener }) }
    bind('keydown-ONE', () => this.showcase('P0'))
    bind('keydown-TWO', () => this.showcase('P1')); bind('keydown-THREE', () => this.showcase('P2')); bind('keydown-FOUR', () => this.showcase('P3')); bind('keydown-FIVE', () => this.showcase('P4'))
    bind('keydown-SIX', () => { this.showcaseP5Variant = 'KO'; this.showcase('P5') }); bind('keydown-SEVEN', () => this.showcase('P6')); bind('keydown-EIGHT', () => this.showcase('P7'))
    bind('keydown-N', () => { this.showcaseBattleVariant = 'NORMAL'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-C', () => { if (this.showcaseState === AppState.BATTLE) { this.showcaseBattleVariant = 'COMBO'; this.render(this.appStateMachine.getCurrentState()) } })
    bind('keydown-Q', () => { this.showcaseBattleVariant = 'DANGER'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-T', () => { this.showcaseBattleVariant = 'LAST_10_SECONDS'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-UP', () => { if (this.showcaseLab) { const length = AnimationLab.count(); this.labIndex = (this.labIndex - 1 + length) % length; this.render(this.appStateMachine.getCurrentState()) } })
    bind('keydown-DOWN', () => { if (this.showcaseLab) { this.labIndex = (this.labIndex + 1) % AnimationLab.count(); this.render(this.appStateMachine.getCurrentState()) } })
    bind('keydown-V', () => { this.showcaseLab = !this.showcaseLab; this.showcaseState = undefined; this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-B', () => { this.selectedStageId = this.selectedStageId === 'laboratory' ? 'company-building' : 'laboratory'; if (this.showcaseLab || this.showcaseState === AppState.SETUP || this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-F', () => { this.labFacing = this.labFacing === 'RIGHT' ? 'LEFT' : 'RIGHT'; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-H', () => { this.labHud = !this.labHud; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-L', () => { this.labLoop = !this.labLoop; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-O', () => { this.showcaseAnnouncer = !this.showcaseAnnouncer; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    const showP5 = (variant: P5ShowcaseVariant): void => { this.showcaseP5Variant = variant; this.showcase('P5') }
    bind('keydown-M', () => showP5('TIME_UP')); bind('keydown-Y', () => showP5('WIN'))
    const showRank = (substate: P6SubState): void => { this.showcaseP6SubState = substate; this.showcase('P6') }
    // R：Lab 內重播，否則預覽 P6 RANK_1_TO_6。
    bind('keydown-R', () => { if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()); else showRank('RANK_1_TO_6') })
    bind('keydown-I', () => showRank('RANK_7_TO_19')); bind('keydown-P', () => showRank('RANK_20')); bind('keydown-U', () => showRank('NOT_RANKED'))
  }

  private showcase(state: string): void {
    if (!import.meta.env.DEV || !this.showcaseEnabled) return
    this.showcaseState = ({ P0: AppState.IDLE, P1: AppState.READY, P2: AppState.SETUP, P3: AppState.LOADING, P4: AppState.BATTLE, P5: AppState.PRESENTATION, P6: AppState.RESULT, P7: AppState.END } as Record<string, AppStateValue>)[state]
    if (this.showcaseState === AppState.BATTLE) this.showcaseBattleVariant = 'NORMAL'
    this.render(this.appStateMachine.getCurrentState())
  }

  private renderOverlay(): void {
    const overlay = this.overlay = this.add.container(0, 0)
    overlay.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.opacity.overlay))
    const confirmMode = this.ui.navigation.isExitConfirmationOpen()
    const panel = new AngularPanel(this, 650, 400, uiTokens.colors.panelRaised).setPosition(960, 540)
    panel.add(this.add.text(0, -140, confirmMode ? 'EXIT GAME?' : 'PAUSED', typography.title).setOrigin(0.5))
    panel.add(this.add.rectangle(0, -92, 560, 1, uiTokens.colors.lineDim, 0.9))
    panel.add(this.add.text(0, 160, 'ENTER / A 確認 ・ ESC / B 返回', typography.note).setOrigin(0.5))
    const actions = confirmMode ? ['CANCEL', 'CONFIRM'] : ['CONTINUE', 'EXIT']
    actions.forEach((action, index) => {
      const buttonColor = action === 'CONTINUE' || action === 'CONFIRM' ? uiTokens.colors.playerPrimary : uiTokens.colors.panel
      const button = new ActionButton(this, action, 380, 66, buttonColor).setPosition(0, -20 + index * 88)
      button.setInteractive({ useHandCursor: true }).on('pointerup', () => this.overlayAction(action))
      panel.add(button)
      this.register(confirmMode ? 'overlay-confirm' : 'overlay', 'overlay-' + action, button, () => this.overlayAction(action))
    })
    overlay.add(panel); this.screen?.add(overlay)
    this.ui.focus.activate(confirmMode ? 'overlay-confirm' : 'overlay')
  }

  private overlayAction(action: string): void {
    if (action === 'CONTINUE' || action === 'CANCEL') this.ui.navigation.dispatch('CLOSE_MENU')
    else if (action === 'EXIT') this.ui.navigation.openExitConfirmation()
    // 先關選單讓時鐘恢復，再離開戰鬥；反過來時鐘會停在暫停狀態到下一場。
    else if (action === 'CONFIRM') { this.ui.navigation.dispatch('CLOSE_MENU'); this.ui.navigation.dispatch('FINISH') }
  }

  private playerEntry(): CharacterEntry { return characterEntry(this.selectedCharacterId) ?? testCharacterManifest.presetA }
  private playerName(): string { return this.players.P1?.nickname || this.playerEntry().displayName }
  // D-01：2P 的選擇只決定 CPU 敵人的外觀與名稱，戰鬥仍由 EnemyAI 控制。
  private opponentEntry(): CharacterEntry | undefined { return this.players.P2 ? undefined : characterEntry(this.opponent?.characterId) }
  private enemyName(): string { const p2 = this.players.P2; if (!p2 && this.opponentEntry()) return this.opponentEntry()?.displayName ?? 'ROG_SAGA'; return p2 ? p2.nickname || characterEntry(p2.characterId)?.displayName || 'ROG_SAGA' : 'ROG_SAGA' }
  /** 流程總步數：選角（含拍照）＋［選對手（1P）］＋選場景。 */
  private stepTotal(): number { return (this.hasCustom() ? 4 : 3) + (this.opponentModel ? 1 : 0) }
  private hasCustom(): boolean { return Object.values(this.players).some((player) => characterEntry(player?.characterId)?.type === 'BODY_TEMPLATE') }
  private playerSpriteId(): SpriteId | undefined { return this.playerEntry().spriteId }
  private enemySpriteId(): SpriteId { return this.opponentEntry()?.spriteId ?? characterEntry(this.players.P2?.characterId)?.spriteId ?? (this.playerSpriteId() === 'riven' ? 'kael' : 'riven') }

  private addCharacterPreview(parent: Phaser.GameObjects.Container, spriteId: SpriteId | undefined, videoUrl: string | undefined, x: number, y: number, width: number, height: number, fallback: Phaser.GameObjects.Graphics): Phaser.GameObjects.Sprite | Phaser.GameObjects.Video | undefined {
    const key = spriteId && spriteTextureKey(spriteId, 'idle')
    if (key && this.textures.exists(key)) {
      const size = Math.min(height, width * 1.3)
      const image = this.add.sprite(x, y, key, spriteTextureFrame(spriteId)).setDisplaySize(size, size)
      if (isSheetSprite(spriteId) && !reducedMotion && this.anims.exists(`${spriteId}-idle`)) image.play(`${spriteId}-idle`)
      parent.add(image); fallback.setVisible(false)
      return image
    }
    return this.addPreviewVideo(parent, videoUrl, x, y, width, height, fallback)
  }

  private addPreviewVideo(parent: Phaser.GameObjects.Container, url?: string, x = 0, y = 0, width = 420, height = 600, fallback?: Phaser.GameObjects.Graphics): Phaser.GameObjects.Video | undefined {
    if (!url) return undefined
    try {
      const video = this.add.video(x, y).loadURL(url, true).setDisplaySize(width, height)
      const rawVideo = (video as unknown as { video?: HTMLVideoElement }).video
      const fit = (): void => { const sourceWidth = rawVideo?.videoWidth ?? 0; const sourceHeight = rawVideo?.videoHeight ?? 0; if (sourceWidth > 0 && sourceHeight > 0) video.setDisplaySize(height * sourceWidth / sourceHeight, height) }
      const hideOnError = (): void => { video.setVisible(false); fallback?.setVisible(true) }
      const showVideo = (): void => { fallback?.setVisible(false) }
      const cleanup = (): void => { rawVideo?.removeEventListener('loadedmetadata', fit); rawVideo?.removeEventListener('error', hideOnError); rawVideo?.removeEventListener('playing', showVideo) }
      rawVideo?.addEventListener('loadedmetadata', fit, { once: true })
      rawVideo?.addEventListener('error', hideOnError, { once: true })
      rawVideo?.addEventListener('playing', showVideo, { once: true })
      video.once(Phaser.GameObjects.Events.DESTROY, cleanup)
      parent.add(video); video.play(true)
      return video
    } catch { return undefined }
  }

  private destroyScreen(): void {
    this.idleLabel = undefined; this.stageBackdrop = undefined; this.inputDebug = undefined
    this.stage?.destroy(); this.stage = undefined; this.battleWorld = undefined
    stopOwnedTweens(this.screenTweens)
    this.loadingPulse = undefined
    this.ui.focus.clearGroup('loading'); this.ui.focus.clearGroup('p0'); this.ui.focus.clearGroup('stage'); this.ui.focus.clearGroup('opponent'); this.ui.focus.clearGroup('presentation'); this.ui.focus.clearGroup('result'); this.ui.focus.clearGroup('end'); this.ui.focus.clearGroup('overlay'); this.ui.focus.clearGroup('overlay-confirm')
    this.keyCaps = []; this.promptDevice = undefined; this.loadingButton = undefined; this.loadingReady = undefined; this.loadingBar = undefined; this.loadingPercent = undefined; this.buttons.clear(); this.p1View?.destroy(); this.p1View = undefined; this.battlePlayer?.destroy()
    this.battlePlayer = undefined; this.battleEnemy = undefined; this.battleRoot = undefined; this.battlePlayerRounds = undefined; this.battleEnemyRounds = undefined; this.previousBattle = undefined; this.battleBanner = undefined;
    this.screen?.destroy(true); this.screen = undefined; this.overlay = undefined
  }
  private readonly attractKey = (event: KeyboardEvent): void => {
    if (this.appStateMachine.getCurrentState() !== AppState.IDLE || this.showcaseState || event.repeat) return
    if (this.controlsPanel || this.boardPanel) return
    if (event.code === 'KeyP') this.playAttract()
    else if (event.code === 'KeyK') this.stopAttract()
    else if (event.code === 'KeyC' && !this.attract) this.controlsPanel = new ControlsPanel(this, new ControlsEditor(this.controls, (profiles) => { saveProfiles(profiles); this.inputManager.setCombatBindings(profiles.P1) }), () => this.closeControls())
  }
  private closeControls(): void { this.controlsPanel?.destroy(); this.controlsPanel = undefined; this.noteActivity() }
  /** DEV ?inputDebug=1：實體鍵 → 語意 → 姿態 → 呈現 → 圖檔。 */
  private updateInputDebug(fighter: Parameters<typeof resolvePresentation>[0]): void {
    const last = this.inputManager.lastCombatInput, presentation = this.battlePlayer?.presentation ?? resolvePresentation(fighter, this.playerContext), sprite = this.playerSpriteId()
    const sheet = presentationSheet[presentation], file = sheetAnimations.find((animation) => animation.key === sheet)?.filename ?? ''
    const animation = isSheetSprite(sprite) ? sheetUrl(sprite, sheet, file).split('/').at(-1)?.replace('.png', '') : `${sprite}-${spriteActionFor(fighter)}`
    this.inputDebug?.setText(['PLAYER 1', `Physical Key: ${last ? keyLabel(last.code) : '-'}`, `Semantic Action: ${last?.action ?? '-'}`, `Fighter Context: ${/AIR$|^JUMP$/.test(presentation) ? 'AIRBORNE' : presentation.includes('CROUCH') ? 'CROUCHING' : 'STANDING'}`, `Resolved Presentation: ${presentation}`, `Animation: ${animation}`].join('\n'))
  }
  /** 開頭動畫：全畫面 DOM video；播完或按 K 回 P0 並重新計算閒置。 */
  private playAttract(): void {
    if (this.attract) return
    const video = document.createElement('video')
    video.src = '/test-assets/attract/intro.mp4'; video.playsInline = true; video.setAttribute('aria-label', 'Opening video')
    video.style.cssText = 'width:1920px;height:1080px;object-fit:cover;background:#000'
    const stopIfCurrent = (): void => { if (this.attract?.node === video) this.stopAttract() }
    video.addEventListener('ended', stopIfCurrent)
    // 有聲自動播放被瀏覽器拒絕時改靜音；仍失敗才結束。
    video.play().catch(() => { if (this.attract?.node !== video) return; video.muted = true; return video.play() }).catch(stopIfCurrent)
    this.attract = this.add.dom(960, 540, video).setDepth(1000)
  }
  private stopAttract(): void {
    if (!this.attract) return
    const video = this.attract.node as HTMLVideoElement
    video.pause(); video.removeAttribute('src'); video.load()
    this.attract.destroy(); this.attract = undefined; this.noteActivity()
  }
  private destroyScene(): void { this.stopAttract(); this.closeControls(); this.closeBoard(false); this.input.keyboard?.off('keydown', this.attractKey); this.destroyScreen(); this.input.off('pointermove', this.noteActivity); this.input.off('pointerdown', this.noteActivity); this.showcaseListeners.forEach(({ event, listener }) => this.input.keyboard?.off(event, listener)); this.combatUnsubscribe?.(); this.unsubscribe?.(); this.clockUnsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()); this.inputManager.detachKeyboard(); this.clock.stop() }
}
