import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { UIFramework } from '../ui/UIFramework'
import { ActionButton, AngularPanel, StageCard, KeyCap, Announcer } from '../ui/VisualComponents'
import { stopOwnedTweens } from '../ui/tweens'
import { uiTokens, colorHex, reducedMotion } from '../ui/tokens/uiTokens'
import { aspectCover } from '../ui/tokens/layout'
import { typography } from '../ui/tokens/typography'
import { InputManager, type OwnedUiAction, type PlayerSlotId } from '../input/InputManager'
import { FIXED_STEP_MS, GameClock } from '../time/GameClock'
import { intentFromInput, type CombatEvent } from '../combat/CombatWorld'
import type { MatchSnapshot } from '../match/MatchController'
import { p6SubStateForRank } from '../match/ResultResolver'
import type { ExperienceFlow } from '../app/ExperienceFlow'
import { P1SelectionModel, type P1Phase } from '../select/P1SelectionModel'
import { LeaderboardPanel } from '../ui/board/LeaderboardPanel'
import { P1SelectView } from '../ui/p1/P1SelectView'
import { endViewModel, leaderboardPanelModel, loadingViewModel, finishAnnouncements, resultViewModel, stageSelectViewModel, type ResultViewModel } from '../ui/ViewModels'
import { characterEntry, resolveStageAsset, stageTextureKey, testCharacterManifest, type CharacterEntry, type StageId } from '../ui/assets/TestAssetManifest'
import { faceKey, TemporarySpriteRenderer } from '../ui/animation/TemporarySpriteRenderer'
import { spriteTextureFrame, spriteTextureKey, type PresentationContext, type SpriteId } from '../ui/animation/TemporarySpriteManifest'
import { isSheetSprite } from '../ui/animation/SheetSpriteManifest'
import { keyLabel, loadProfiles, saveProfiles, type CombatAction } from '../input/ControlProfile'
import { ControlsPanel } from '../ui/controls/ControlsPanel'
import { BattleStage } from '../ui/stage/BattleStage'
import { BattleView } from '../ui/battle/BattleView'
import { GameAudio } from '../audio/GameAudio'
import { combatCues, finishCues } from '../audio/AudioCues'

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
  private clockUnsubscribe?: () => void
  private combatUnsubscribe?: () => void
  private tickEvents: CombatEvent[] = []
  private battlePlayer?: TemporarySpriteRenderer
  private battleEnemy?: TemporarySpriteRenderer
  private keyCaps: KeyCap[] = []
  private promptDevice?: string
  private loadingButton?: ActionButton
  private loadingBar?: Phaser.GameObjects.Rectangle
  private loadingPercent?: Phaser.GameObjects.Text
  private loadingReady?: boolean
  private loadingPulse?: Phaser.Tweens.Tween
  private battleRoot?: Phaser.GameObjects.Container
  private selectedStageId: StageId = 'laboratory'
  private overlay?: Phaser.GameObjects.Container
  private p1Model?: P1SelectionModel
  private p1View?: P1SelectView
  private p1Offline = false
  private lastActivity = 0
  private idleLabel?: Phaser.GameObjects.Text
  private stageBackdrop?: Phaser.GameObjects.Image
  private stage?: BattleStage
  private attract?: Phaser.GameObjects.DOMElement
  private attractInputConsumed = false
  private attractPadButtons = new Set<string>()
  private exitLockedUntil = 0
  private audio?: GameAudio
  private battleView?: BattleView
  private readonly controls = loadProfiles()
  private controlsPanel?: ControlsPanel
  private boardPanel?: LeaderboardPanel
  private boardRequest = 0
  private readonly playerContext: PresentationContext = {}
  private readonly enemyContext: PresentationContext = {}
  private readonly noteActivity = (): void => { this.lastActivity = this.time.now }

  constructor(appStateMachine: AppStateMachine, ui: UIFramework, private readonly flow: ExperienceFlow) {
    super('AppScene'); this.appStateMachine = appStateMachine; this.ui = ui
  }
  private get persistence() { return this.flow.persistence }

  create(): void {
    this.audio = new GameAudio(this, this.ui.events)
    this.selectedStageId = resolveStageAsset(this.persistence?.context.snapshot.selectedStageId).id
    this.input.on('pointermove', this.noteActivity); this.input.on('pointerdown', this.noteActivity)
    if (typeof window !== 'undefined') this.inputManager.attachKeyboard(window)
    this.inputManager.setCombatBindings(this.controls)
    this.input.keyboard?.on('keydown', this.attractKey); this.noteActivity()
    this.clock.start()
    void this.flow.refreshLeaderboard()
    this.flow.onOffline = () => { this.p1Offline = true; this.p1View?.setOffline() }
    this.flow.onResultStored = () => this.render(this.appStateMachine.getCurrentState())
    // 轉移副作用（session／match／persistence）由 ExperienceFlow 先處理；這裡只管呈現。
    this.unsubscribe = this.appStateMachine.subscribe(({ previousState, nextState }) => {
      if (nextState === AppState.BATTLE) { this.audio?.loop('amb-cheer'); this.inputManager.setVersus(Boolean(this.flow.players.P2)) }
      if (previousState === AppState.BATTLE && nextState === AppState.PRESENTATION && this.flow.result) {
        this.audio?.playSequence(combatCues(this.tickEvents.splice(0)))
        this.audio?.playSequence(finishCues(this.flow.result, Boolean(this.flow.players.P2), this.flow.match.world.getConfig().maxHp, this.flow.match.getRoundSummaries().at(-1)))
        this.audio?.play({ id: 'amb-claps' })
      }
      if (previousState === AppState.BATTLE && nextState !== AppState.PRESENTATION) this.audio?.stopLoop()
      if (previousState === AppState.PRESENTATION) this.audio?.stopLoop()
      if (nextState === AppState.READY) this.p1Offline = false
      if (previousState === AppState.READY) this.p1Model = undefined
      this.lastActivity = this.time.now
      if (nextState !== AppState.IDLE) { this.stopAttract(); this.closeControls(); this.closeBoard() }
      if (nextState === AppState.BATTLE) { this.tickEvents = []; this.combatUnsubscribe?.(); this.combatUnsubscribe = this.flow.match.world.subscribe((event) => { this.tickEvents.push(event) }) }
      this.render(nextState)
    })
    this.clockUnsubscribe = this.clock.subscribe(() => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) return
      const input = this.inputManager.consumeGameplaySnapshot(), p2 = this.inputManager.consumeGameplaySnapshot('P2')
      // 蹲是純呈現：只在可操作時顯示（起手序列與回合結束停留不蹲）；ENEMY 只有 2P 真人時才看 2P 的蹲鍵。
      const fighting = this.flow.match.getSnapshot().matchState === 'FIGHTING'
      this.playerContext.crouch = fighting && input.crouchHeld
      this.enemyContext.crouch = fighting && Boolean(this.flow.players.P2) && p2.crouchHeld
      this.flow.tick(intentFromInput(input), intentFromInput(p2))
      if (this.appStateMachine.getCurrentState() === AppState.BATTLE) this.updateBattle(this.flow.match.getSnapshot())
    })
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', ({ screen }) => { if (screen === AppState.BATTLE && this.battleRoot) return; this.render(this.appStateMachine.getCurrentState()) }))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', ({ open }) => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) { this.render(this.appStateMachine.getCurrentState()); return }
      if (open) { this.clock.pause(); this.anims.pauseAll() } else { this.clock.resume(); this.anims.resumeAll() }
      if (open) this.audio?.pauseLoop(); else this.audio?.resumeLoop()
      this.stage?.pause(open)
      // Keep fighter interpolation history intact while opening or closing the menu.
      this.ui.focus.clearGroup('overlay'); this.ui.focus.clearGroup('overlay-confirm')
      this.overlay?.destroy(true); this.overlay = undefined
      if (open) this.renderOverlay()
    }))
    this.uiUnsubscribers.push(this.ui.events.on('FOCUS_CHANGED', ({ previous, next }) => { this.buttons.get(previous ?? '')?.setFocused(false); this.buttons.get(next ?? '')?.setFocused(true) }))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyScene())
    this.render(this.appStateMachine.getCurrentState())
  }

  update(_time: number, delta: number): void { const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => pad !== null) : []; this.inputManager.update(gamepads)
    const padButtons = new Set(gamepads.flatMap((pad, p) => pad.buttons.flatMap((button, b) => button.pressed || button.value >= 0.5 ? [`${p}:${b}`] : [])))
    if ([...padButtons].some(button => !this.attractPadButtons.has(button))) {
      this.lastActivity = _time
      if (this.attract) { this.stopAttract(); this.attractInputConsumed = true }
    }
    this.attractPadButtons = padButtons
    const battling = this.appStateMachine.getCurrentState() === AppState.BATTLE
    const visualState = this.appStateMachine.getCurrentState()
    // P1／P2 逐層返回；P3／P5／P6 返回主畫面（backRoutes）。
    const backScreen = ([AppState.READY, AppState.SETUP, AppState.LOADING, AppState.PRESENTATION, AppState.RESULT] as AppStateValue[]).includes(visualState)
    const owned = this.inputManager.consumeOwnedUiActions(), actions = this.inputManager.consumeUiActions()
    if (owned.length || actions.length) this.lastActivity = _time
    const typing = document.activeElement instanceof HTMLInputElement, pause = this.inputManager.consumePause()
    if (this.attract || this.attractInputConsumed || this.controlsPanel || this.boardPanel) {
      // 開頭動畫、操作設定或排行榜開啟中：UI 輸入不穿透到 P0；手把的 BACK／CONFIRM 可關閉排行榜。
      if (this.boardPanel && actions.some((action) => action === 'BACK' || action === 'CONFIRM')) this.closeBoard()
    } else if (!typing && visualState === AppState.READY && this.p1Model) {
      // P1 由 1P/2P 擁有者鍵位操作；未標記輸入只保留 Esc（選角中返回標題）。
      if (this.p1View?.exitOpen) this.p1View.handleExit([...actions, ...owned.filter(({ owner }) => owner === 'P1').map(({ action }) => action)])
      else if (actions.includes('BACK')) {
        if (this.p1Model.owner) this.p1View?.confirmExit(() => { this.p1Model?.abortCustomize(); this.syncP1() })
        else this.ui.navigation.dispatch('BACK')
      } else owned.forEach(({ owner, action }) => this.p1Input(owner, action))
    } else if (battling && !this.ui.navigation.isOverlayOpen()) {
      // P4 未暫停：只看 Combat profile 的 PAUSE，選單鍵不作用；暫停後才交給選單鍵。
      if (pause) this.ui.navigation.dispatch('OPEN_MENU')
    } else if (!typing) {
      // 暫停選單只屬於 P4；其他畫面的 Escape／M 不開啟選單。
      // 1P 選單鍵（跟自訂鍵位，預設 WASD/J/K）在後續選單同樣有效；2P 鍵與未標記鍵重複（方向鍵/Enter），不併入以免重複觸發。
      actions.push(...owned.filter(({ owner }) => owner === 'P1').map(({ action }) => action))
      actions.filter((action) => !(visualState === AppState.SETUP && this.stageNav(action))).filter((action) => this.ui.navigation.isOverlayOpen() || battling || (action === 'BACK' && backScreen) || (action !== 'OPEN_MENU' && action !== 'BACK')).forEach((action) => { if (!this.ui.navigation.isExitConfirmationOpen() || performance.now() >= this.exitLockedUntil) this.ui.navigation.dispatch(action) })
    }
    this.attractInputConsumed = false
    this.checkIdle(_time)
    // 選單或暫停中的跳躍／攻擊按下不留到戰鬥（手把 A 同時是 CONFIRM 與 JUMP）。
    if (!battling || this.clock.isPaused()) { this.inputManager.consumeGameplaySnapshot(); this.inputManager.consumeGameplaySnapshot('P2') }
    this.clock.advance(delta)
    if (this.appStateMachine.getCurrentState() === AppState.BATTLE) {
      const alpha = Phaser.Math.Clamp(this.clock.getRemainderMs() / FIXED_STEP_MS, 0, 1)
      this.battlePlayer?.renderAt(alpha); this.battleEnemy?.renderAt(alpha)
      // 鏡頭只改呈現：在插值後依兩名角色位置更新，不回寫 Combat。
      this.battleView?.renderAt(alpha)
      const player = this.battleView?.player ?? this.battlePlayer, enemy = this.battleView?.enemy ?? this.battleEnemy
      if (player && enemy) this.stage?.follow(player.x, enemy.x, reducedMotion ? Infinity : delta / 1000)
    }
    if (visualState === AppState.LOADING) this.updateLoading() }

  private render(visualState: AppStateValue): void {
    this.destroyScreen(); document.body.style.setProperty('--backdrop', `url("${resolveStageAsset(this.selectedStageId).url}")`); this.screen = this.add.container(0, 0).setAlpha(reducedMotion ? 1 : 0); this.addBackground(this.screen, visualState)
    if (visualState === AppState.IDLE) this.renderP0(); if (visualState === AppState.READY) this.renderP1(); if (visualState === AppState.SETUP) this.renderP2(); if (visualState === AppState.LOADING) this.renderP3(); if (visualState === AppState.BATTLE) { this.renderP4(); this.updateBattle(this.flow.match.getSnapshot()) }; if (visualState === AppState.PRESENTATION) this.renderP5(); if (visualState === AppState.RESULT) this.renderP6(); if (visualState === AppState.END) this.renderP7()
    if (this.ui.navigation.isOverlayOpen()) this.renderOverlay()
    this.addScreenTween({ targets: this.screen, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' })
  }

  private addBackground(container: Phaser.GameObjects.Container, state: AppStateValue): void {
    if (state === AppState.BATTLE || state === AppState.PRESENTATION) return
    const darkness = state === AppState.IDLE ? uiTokens.backdrop.empty : state === AppState.END ? uiTokens.backdrop.end : state === AppState.RESULT ? uiTokens.backdrop.result : uiTokens.backdrop.content
    const cover = aspectCover(2752, 1536, uiTokens.logicalWidth, uiTokens.logicalHeight)
    const backdrop = this.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(this.selectedStageId)).setDisplaySize(cover.width, cover.height)
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
    container.add(atmosphere)
  }
  private heading(text: string, x = 110, y = 112): Phaser.GameObjects.Text { return this.add.text(x, y, text, typography.heading).setOrigin(0, 0.5) }
  private label(text: string, x: number, y: number, size: number = uiTokens.type.body, color = colorHex('textSecondary')): Phaser.GameObjects.Text { return this.add.text(x, y, text, { ...typography.note, fontSize: size, color }).setOrigin(0.5) }
  private register(group: string, id: string, object: Focusable, activate: () => void, enabled = true): void {
    this.buttons.set(id, object); this.ui.focus.register(group, id, enabled, activate)
    object.on('pointerover', () => { if (this.ui.navigation.isExitConfirmationOpen() && performance.now() < this.exitLockedUntil) return; if (object.input?.enabled && this.ui.focus.current() !== id) this.ui.focus.activate(group, id) })
  }
  private addScreenTween(config: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween | undefined { if (reducedMotion && config.repeat === -1) return; const tween = this.tweens.add(reducedMotion ? { ...config, duration: 0, delay: 0 } : config); this.screenTweens.push(tween); tween.once('complete', () => { const index = this.screenTweens.indexOf(tween); if (index >= 0) this.screenTweens.splice(index, 1) }); return tween }

  /** P0 只有場景背景、START 與提示；排行在遊玩後的 P6／P7 呈現。 */
  private renderP0(): void {
    const start = new ActionButton(this, 'START', 420, 100, uiTokens.colors.playerPrimary, '開始遊戲').setPosition(740, 860)
    const board = new ActionButton(this, 'BOARD', 420, 100, uiTokens.colors.panelRaised, '排行榜').setPosition(1180, 860)
    const begin = (): void => { this.appStateMachine.transitionTo(AppState.READY) }
    start.on('pointerup', () => { this.audio?.ui('CONFIRM'); begin() }); board.on('pointerup', () => { this.audio?.ui('CONFIRM'); this.openBoard() })
    this.screen?.add([start, board]); this.register('p0', 'p0-start', start, begin); this.register('p0', 'p0-board', board, () => this.openBoard()); this.ui.focus.activate('p0', 'p0-start')
    this.screen?.add(this.label(`${keyLabel(this.controls.P1.LIGHT_PUNCH)} / ENTER 確認 · ← → 切換 · P 播放開頭動畫 · C 操作設定`, 960, 960, uiTokens.type.label))
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
    const result = this.p1Model?.input(owner, action)
    if (action !== 'CONFIRM' || result === 'CONFIRMED') this.audio?.ui(action)
    if (result && result !== 'CONFIRMED') this.p1View?.feedback(owner, result)
    this.syncP1()
  }
  /** Customize 各步驟是 P1 substate：切換時整頁重建，其餘只同步常駐物件。 */
  private syncP1(): void {
    const phase: P1Phase = this.p1Model?.phase ?? 'GRID'
    const substate = phase === 'GRID' || phase === 'OPPONENT' || phase === 'DIFFICULTY' || phase === 'ALL_READY' ? 'READY' : phase === 'FAILED' ? 'FALLBACK' : phase
    if (!this.ui.substates.set(AppState.READY, substate)) this.p1View?.sync()
  }
  private confirmPlayers(): void {
    const players = this.p1Model?.result() ?? {}
    if (!players.P1 || this.p1Model?.phase !== 'ALL_READY') return
    this.flow.setPlayers(players); this.flow.opponent = this.p1Model.opponent()
    this.applyFaces()
    this.appStateMachine.transitionTo(AppState.SETUP)
  }
  // ponytail: 拍照頭像暫以圓形貼在 Body 頭部，示意 ComfyUI 算圖結果；接上生成服務後改用回傳的角色 sheet、移除這段。
  private applyFaces(): void {
    (['P1', 'P2'] as const).forEach((id) => {
      const key = faceKey(id), photo = this.p1Model?.player(id).photo
      if (this.textures.exists(key)) this.textures.remove(key)
      if (!photo) return
      const image = new Image()
      image.onload = () => {
        const size = Math.min(image.width, image.height), canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), context = canvas.getContext('2d')
        if (!context || this.textures.exists(key)) return
        context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.clip()
        context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 256, 256)
        context.lineWidth = 12; context.strokeStyle = '#ffffff'; context.stroke()
        this.textures.addCanvas(key, canvas)
      }
      image.src = photo
    })
  }
  private checkIdle(now: number): void {
    if (!this.lastActivity) return
    const state = this.appStateMachine.getCurrentState(), idle = now - this.lastActivity, { idleMs } = uiTokens.p1
    if (state === AppState.IDLE) { if (!this.attract && !this.controlsPanel && !this.boardPanel && idle >= idleMs.attract) this.playAttract(); return }
    const phase = this.p1Model?.phase
    const limit = state === AppState.READY ? phase === 'GRID' || phase === 'OPPONENT' || phase === 'DIFFICULTY' ? idleMs.select : phase === 'CUSTOMIZE' || phase === 'REVIEW' || phase === 'FAILED' ? idleMs.customize : 0 : 0
    if (!limit) { this.idleLabel?.setText(''); return }
    if (!this.idleLabel) { this.idleLabel = this.label('', 960, 42, uiTokens.type.label, colorHex('resultGold')); this.screen?.add(this.idleLabel) }
    this.idleLabel.setText(idle >= limit - 10000 ? `閒置倒數 ${Math.max(0, Math.ceil((limit - idle) / 1000))}s · 操作以繼續` : '')
    if (idle < limit) return
    this.noteActivity()
    if (state === AppState.READY && this.p1Model?.owner) { this.p1Model.abortCustomize(); this.syncP1() }
    else this.ui.navigation.dispatch('FINISH')
  }

  private renderP2(): void {
    const vm = stageSelectViewModel(this.selectedStageId)
    this.screen?.add(this.heading(vm.heading)); this.screen?.add(this.add.text(110, 174, `${this.stepTotal()} / ${this.stepTotal()}` + ' ・ 選擇對戰場景', typography.instruction))
    vm.stages.forEach((stage, index) => {
      const card = new StageCard(this, stage.label, stageTextureKey(stage.id), 780, 500, stage.id === 'laboratory' ? '實驗室' : '企業總部').setPosition(530 + index * 860, 550).setSelected(stage.id === vm.selectedStageId)
      const pick = (): void => { this.selectStage(stage.id, true); this.ui.focus.activate('stage', 'stage-confirm') }
      // 滑鼠點卡＝選取並移到確認；鍵盤焦點即選取，確認鍵直接進 P3。
      card.setInteractive({ useHandCursor: true }).on('pointerup', pick); this.screen?.add(card); this.register('stage', `stage-${stage.id}`, card, () => this.confirmStage())
    })
    this.addBackButton('stage')
    const confirm = new ActionButton(this, 'CONFIRM', 350, 88, uiTokens.colors.playerPrimary, '確認').setPosition(1610, 952)
    confirm.on('pointerup', () => this.confirmStage()); this.screen?.add(confirm); this.register('stage', 'stage-confirm', confirm, () => this.confirmStage()); this.ui.focus.activate('stage', `stage-${vm.selectedStageId}`)
  }
  /** P2 場景卡：←→ 切卡即選取，↓ 到確認，↑ 回選取的卡。回傳 true 表示已處理。 */
  private stageNav(action: string): boolean {
    const ids = stageSelectViewModel().stages.map((stage) => stage.id), onCard = ids.some((id) => this.ui.focus.current() === `stage-${id}`)
    if (onCard && (action === 'NAV_LEFT' || action === 'NAV_RIGHT')) {
      const next = ids[(ids.indexOf(this.selectedStageId) + (action === 'NAV_RIGHT' ? 1 : ids.length - 1)) % ids.length]
      this.selectStage(next, true); this.ui.focus.activate('stage', `stage-${next}`); return true
    }
    if (onCard && action === 'NAV_DOWN') { this.ui.focus.activate('stage', 'stage-confirm'); return true }
    if (onCard && action === 'NAV_UP') return true
    if (!onCard && action === 'NAV_UP') { this.ui.focus.activate('stage', `stage-${this.selectedStageId}`); return true }
    return false
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
    root.add(this.add.graphics().lineStyle(8, uiTokens.colors.systemBlue, 0.4).lineBetween(1100, 0, 820, 710))
    this.addCharacterPreview(root, vm.character.spriteId, 430, 360, 560, 700)
    this.addCharacterPreview(root, this.enemySpriteId(), 1480, 360, 560, 700)?.setFlipX(true)
    root.add(this.add.text(130, 565, 'PLAYER', { ...typography.note, color: colorHex('playerGlow') }))
    root.add(this.add.text(130, 600, vm.playerName, typography.title))
    if (vm.character.type === 'BODY_TEMPLATE') root.add(this.add.text(130, 680, vm.character.displayName + ' · TEMP BODY', { ...typography.note, color: colorHex('resultGold') }))
    root.add(this.add.text(1780, 565, this.flow.players.P2 ? 'ENEMY · 2P' : 'ENEMY · CPU', { ...typography.note, color: colorHex('enemyGlow') }).setOrigin(1, 0))
    root.add(this.add.text(1780, 600, vm.enemyName, typography.title).setOrigin(1, 0))
    root.add(this.add.text(960, 330, 'VS', { ...typography.title, fontSize: uiTokens.type.hero, stroke: colorHex('systemBlue'), strokeThickness: 8 }).setOrigin(0.5).setRotation(-0.08))
    root.add(this.label(vm.stage, 960, 670, uiTokens.type.body))
    const controls = new AngularPanel(this, 1030, 294, uiTokens.colors.panelRaised).setPosition(620, 865)
    controls.add(this.add.text(-465, -120, 'CONTROLS ・ 操作說明', typography.secondaryAction))
    const key = (...actions: CombatAction[]): string => actions.map((action) => keyLabel(this.controls.P1[action])).join(' ')
    controls.add(this.add.text(475, -112, `${key('CROUCH')} 蹲 · ${key('GUARD')}／← 後退＝防禦 · ${key('PAUSE')} 暫停`, typography.note).setOrigin(1, 0))
    const bindings = [['MOVE', key('MOVE_LEFT', 'MOVE_RIGHT'), '← →'], ['JUMP', key('JUMP'), '↑'], ['PUNCH', key('LIGHT_PUNCH', 'HEAVY_PUNCH'), 'X Y'], ['KICK', key('LIGHT_KICK', 'HEAVY_KICK'), 'A B']]
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
    this.battleView = new BattleView(this, root, world, { stage: this.selectedStageId, playerSprite: this.playerSpriteId(), enemySprite: this.enemySpriteId(), playerName: this.playerName(), enemyName: this.enemyName(), twoPlayer: Boolean(this.flow.players.P2), floorY: this.flow.match.world.getConfig().floorY, maxHp: this.flow.match.world.getConfig().maxHp, input: this.inputManager, audio: this.audio, combat: this.flow.match.world })
  }
  private addBattleStage(root: Phaser.GameObjects.Container, darkness: number): Phaser.GameObjects.Container {
    this.stage = new BattleStage(this, root, this.selectedStageId, reducedMotion, () => this.addAtmosphere(root, darkness))
    return this.stage.world
  }
  private updateBattle(snapshot: MatchSnapshot): void {
    this.battleView?.update(snapshot, this.tickEvents.splice(0), this.playerContext, this.flow.match.getRoundSummaries().at(-1), this.enemyContext)
  }
  private renderP5(): void {
    this.battleRoot = this.add.container(0, 0); this.screen?.add(this.battleRoot); const world = this.addBattleStage(this.battleRoot, uiTokens.backdrop.presentation)
    const snapshot = this.flow.match.getSnapshot()
    this.battlePlayer = new TemporarySpriteRenderer(this, this.playerSpriteId(), this.flow.match.world.getConfig().floorY, faceKey('P1'))
    this.battlePlayer.update(snapshot.world.fighters.PLAYER, snapshot.world.tick)
    this.battleEnemy = new TemporarySpriteRenderer(this, this.enemySpriteId(), this.flow.match.world.getConfig().floorY, faceKey('P2'))
    this.battleEnemy.update(snapshot.world.fighters.ENEMY, snapshot.world.tick)
    world.add([this.battlePlayer, this.battleEnemy])
    this.battleRoot.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.backdrop.impact))
    const rays = this.add.graphics().setPosition(960, 450)
    for (let i = 0; i < 26; i += 1) { const angle = i * Math.PI * 2 / 26; rays.fillStyle(uiTokens.colors.playerPrimary, 0.1).fillTriangle(0, 0, Math.cos(angle) * 1500, Math.sin(angle) * 1500, Math.cos(angle + 0.04) * 1500, Math.sin(angle + 0.04) * 1500) }
    this.battleRoot.add(rays); this.addScreenTween({ targets: rays, angle: 360, duration: 12000, repeat: -1 })
    const impact = this.add.graphics()
    impact.lineStyle(20, uiTokens.colors.danger, 0.46).lineBetween(465, 610, 1455, 315)
    impact.lineStyle(6, uiTokens.colors.resultGold, 0.62).lineBetween(520, 635, 1405, 370)
    impact.lineStyle(3, uiTokens.colors.playerGlow, 0.38).lineBetween(580, 660, 1320, 410)
    this.battleRoot.add(impact)
    // 與 P4 同一個 Announcer：結束方式（大字）＋勝負。
    if (this.flow.result) { const [call, outcome] = finishAnnouncements(this.flow.result); this.screen?.add([new Announcer(this, 330).show(call), new Announcer(this, 600).show(outcome)]) }
    this.flow.match.getRoundSummaries().forEach((round, index, rounds) => {
      const panel = new AngularPanel(this, 210, 100, round.winner === 'PLAYER' ? uiTokens.colors.playerPrimary : round.winner === 'ENEMY' ? uiTokens.colors.enemyPrimary : uiTokens.colors.panelRaised).setPosition(960 + (index - (rounds.length - 1) / 2) * 230, 700)
      panel.add(this.label('ROUND ' + round.roundNumber, 0, -22, uiTokens.type.label))
      panel.add(this.add.text(0, 18, round.winner === 'PLAYER' ? 'WIN' : round.winner === 'ENEMY' ? 'LOSE' : 'DRAW', typography.action).setOrigin(0.5)); this.screen?.add(panel)
    })
    if (this.flow.result) {
      const next = new ActionButton(this, 'VIEW RESULTS', 420, 96, uiTokens.colors.playerPrimary, '查看結算').setPosition(960, 952)
      next.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.RESULT))
      this.screen?.add(next); this.register('presentation', 'presentation-next', next, () => this.appStateMachine.transitionTo(AppState.RESULT)); this.ui.focus.activate('presentation')
    }
  }

  private renderP6(): void {
    if (this.flow.result) this.renderResultColumns(resultViewModel(this.flow.result, this.persistence?.context.snapshot.backendRank ?? null, p6SubStateForRank(this.persistence?.context.snapshot.backendRank), this.flow.leaderboard, this.persistence?.context.snapshot.sessionId))
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
    if (this.flow.result) {
      const next = new ActionButton(this, 'CONTINUE', 380, 88, uiTokens.colors.playerPrimary, '繼續').setPosition(960, 952)
      next.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.END))
      this.screen?.add(next); this.register('result', 'result-next', next, () => this.appStateMachine.transitionTo(AppState.END)); this.ui.focus.activate('result')
    }
  }

  private renderP7(): void {
    const vm = endViewModel(this.flow.nextPlayerName)
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
      next.add(this.add.text(-60, 34, vm.nextPlayerName, { ...typography.secondaryAction, fontSize: uiTokens.type.body }).setOrigin(0, 0.5))
      this.screen?.add(next)
    }
  }
  private renderOverlay(): void {
    const overlay = this.overlay = this.add.container(0, 0)
    overlay.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.opacity.overlay))
    const confirmMode = this.ui.navigation.isExitConfirmationOpen()
    if (confirmMode) this.exitLockedUntil = performance.now() + 400
    const panel = new AngularPanel(this, 650, 400, uiTokens.colors.panelRaised).setPosition(960, 540)
    panel.add(this.add.text(0, -140, confirmMode ? 'EXIT GAME?' : 'PAUSED', typography.title).setOrigin(0.5))
    if (confirmMode) panel.add(this.add.text(0, -74, '將回到首頁，本局成績不列入排行榜', typography.note).setOrigin(0.5))
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
    if (this.ui.navigation.isExitConfirmationOpen() && performance.now() < this.exitLockedUntil) return
    if (action === 'CONTINUE' || action === 'CANCEL') this.ui.navigation.dispatch('CLOSE_MENU')
    else if (action === 'EXIT') this.ui.navigation.openExitConfirmation()
    // 先關選單讓時鐘恢復，再離開戰鬥；反過來時鐘會停在暫停狀態到下一場。
    else if (action === 'CONFIRM') { this.ui.navigation.dispatch('CLOSE_MENU'); this.ui.navigation.dispatch('FINISH') }
  }

  private playerEntry(): CharacterEntry { return characterEntry(this.flow.players.P1?.characterId) ?? testCharacterManifest.presetA }
  private playerName(): string { return this.flow.players.P1?.nickname || this.playerEntry().displayName }
  // 單人：ENEMY 為選定的 CPU 對手；雙人：ENEMY 為 2P 的選擇，由 2P 操作。
  private opponentEntry(): CharacterEntry | undefined { return this.flow.players.P2 ? undefined : characterEntry(this.flow.opponent?.characterId) }
  private enemyName(): string { const p2 = this.flow.players.P2; if (!p2 && this.opponentEntry()) return this.opponentEntry()?.displayName ?? 'ROG_SAGA'; return p2 ? p2.nickname || characterEntry(p2.characterId)?.displayName || 'ROG_SAGA' : 'ROG_SAGA' }
  /** 流程總步數：選角（含拍照、1P 選對手）＋選場景。 */
  private stepTotal(): number { return this.hasCustom() ? 4 : 3 }
  private hasCustom(): boolean { return Object.values(this.flow.players).some((player) => characterEntry(player?.characterId)?.type === 'BODY_TEMPLATE') }
  private playerSpriteId(): SpriteId | undefined { return this.playerEntry().spriteId }
  private enemySpriteId(): SpriteId { return this.opponentEntry()?.spriteId ?? characterEntry(this.flow.players.P2?.characterId)?.spriteId ?? (this.playerSpriteId() === 'riven' ? 'kael' : 'riven') }

  private addCharacterPreview(parent: Phaser.GameObjects.Container, spriteId: SpriteId | undefined, x: number, y: number, width: number, height: number): Phaser.GameObjects.Sprite | undefined {
    const key = spriteId && spriteTextureKey(spriteId, 'idle')
    if (key && this.textures.exists(key)) {
      const size = Math.min(height, width * 1.3)
      const image = this.add.sprite(x, y, key, spriteTextureFrame(spriteId)).setDisplaySize(size, size)
      if (isSheetSprite(spriteId) && !reducedMotion && this.anims.exists(`${spriteId}-idle`)) image.play(`${spriteId}-idle`)
      parent.add(image)
      return image
    }
    return undefined // 無貼圖：不畫替代形狀
  }

  private destroyScreen(): void {
    this.idleLabel = undefined; this.stageBackdrop = undefined
    this.battleView?.destroy(); this.battleView = undefined; this.stage?.destroy(); this.stage = undefined
    stopOwnedTweens(this.screenTweens)
    this.loadingPulse = undefined
    this.ui.focus.clearGroup('loading'); this.ui.focus.clearGroup('p0'); this.ui.focus.clearGroup('stage'); this.ui.focus.clearGroup('presentation'); this.ui.focus.clearGroup('result'); this.ui.focus.clearGroup('end'); this.ui.focus.clearGroup('overlay'); this.ui.focus.clearGroup('overlay-confirm')
    this.keyCaps = []; this.promptDevice = undefined; this.loadingButton = undefined; this.loadingReady = undefined; this.loadingBar = undefined; this.loadingPercent = undefined; this.buttons.clear(); this.p1View?.destroy(); this.p1View = undefined
    this.battlePlayer = undefined; this.battleEnemy = undefined; this.battleRoot = undefined
    this.screen?.destroy(true); this.screen = undefined; this.overlay = undefined
  }
  private readonly attractKey = (event: KeyboardEvent): void => {
    if (this.appStateMachine.getCurrentState() !== AppState.IDLE || event.repeat) return
    if (this.controlsPanel || this.boardPanel) return
    if (this.attract) { this.stopAttract(); this.attractInputConsumed = true; return }
    this.noteActivity()
    if (event.code === 'KeyP') this.playAttract()
    else if (event.code === 'KeyC' && !this.attract) this.controlsPanel = new ControlsPanel(this, this.controls, (profiles) => { saveProfiles(profiles); this.inputManager.setCombatBindings(profiles) }, () => { this.closeControls(); this.render(AppState.IDLE) }) // 重繪 P0：提示鍵名跟著新鍵位
  }
  private closeControls(): void { this.controlsPanel?.destroy(); this.controlsPanel = undefined; this.noteActivity() }
  /** 開頭動畫：播完或輸入後回 P0 並重新計算閒置。 */
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
  private destroyScene(): void { this.audio?.destroy(); this.audio = undefined; this.stopAttract(); this.closeControls(); this.closeBoard(false); this.input.keyboard?.off('keydown', this.attractKey); this.destroyScreen(); this.input.off('pointermove', this.noteActivity); this.input.off('pointerdown', this.noteActivity); this.combatUnsubscribe?.(); this.unsubscribe?.(); this.clockUnsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()); this.inputManager.detachKeyboard(); this.clock.stop() }
}
