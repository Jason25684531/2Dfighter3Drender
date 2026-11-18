import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { UIFramework } from '../ui/UIFramework'
import { uiTokens, colorHex, reducedMotion } from '../ui/tokens/uiTokens'
import { aspectCover } from '../ui/tokens/layout'
import { typography } from '../ui/tokens/typography'
import { InputManager, type OwnedUiAction, type PlayerSlotId } from '../input/InputManager'
import { GameClock } from '../time/GameClock'
import { intentFromInput, type CombatEvent } from '../combat/CombatWorld'
import { p6SubStateForRank } from '../match/ResultResolver'
import type { ExperienceFlow } from '../app/ExperienceFlow'
import { faceKey, GenerationJobs } from '../app/GenerationJobs'
import { P1SelectionModel, type P1Phase } from '../select/P1SelectionModel'
import { LeaderboardPanel } from '../ui/board/LeaderboardPanel'
import { P1SelectView } from '../ui/p1/P1SelectView'
import { endViewModel, leaderboardPanelModel, resultViewModel } from '../ui/ViewModels'
import { characterEntries, characterEntry, resolveStageAsset, stageTextureKey, testCharacterManifest, type CharacterEntry, type StageId } from '../ui/assets/TestAssetManifest'
import type { PresentationContext, SpriteId } from '../ui/animation/TemporarySpriteManifest'
import { alignedSprites, type AlignedSpriteId } from '../ui/animation/SheetSpriteManifest'
import { deleteGeneratedCharacter, dropGeneratedTextures, dropHead, loadHdSprite, loadHeads, sharpSprite } from '../api/CharacterGeneration'
import { keyLabel, loadProfiles, saveProfiles } from '../input/ControlProfile'
import { ControlsPanel } from '../ui/controls/ControlsPanel'
import { loadPadProfiles, PAD_SYSTEM, padLabel, savePadProfiles, type PadProfiles } from '../input/GamepadProfile'
import { GameAudio } from '../audio/GameAudio'
import { combatCues, finishCues } from '../audio/AudioCues'
import { addAtmosphere, ArenaScreen, type Focusable, type Matchup, type ScreenContext, type ScreenView } from '../ui/screens/ScreenView'
import { HomeScreen } from '../ui/screens/HomeScreen'
import { SelectScreen } from '../ui/screens/SelectScreen'
import { StageSelectScreen } from '../ui/screens/StageSelectScreen'
import { LoadingScreen } from '../ui/screens/LoadingScreen'
import { BattleScreen } from '../ui/screens/BattleScreen'
import { PresentationScreen } from '../ui/screens/PresentationScreen'
import { ResultScreen } from '../ui/screens/ResultScreen'
import { EndScreen } from '../ui/screens/EndScreen'
import { PauseOverlay } from '../ui/screens/PauseOverlay'

/** 唯一的遊戲場景：持有跨畫面的輸入、時鐘、音效、閒置與開頭動畫；每個 AppState 的畫面由 ScreenView 子類別負責。 */
export class AppScene extends Phaser.Scene {
  private readonly appStateMachine: AppStateMachine
  private readonly ui: UIFramework
  private current?: ScreenView
  private overlay?: PauseOverlay
  private screenContext!: ScreenContext
  private unsubscribe?: () => void
  private readonly uiUnsubscribers: Array<() => void> = []
  private readonly buttons = new Map<string, Focusable>()
  private readonly inputManager = new InputManager()
  private readonly clock = new GameClock()
  private clockUnsubscribe?: () => void
  private combatUnsubscribe?: () => void
  private tickEvents: CombatEvent[] = []
  private selectedStageId: StageId = 'laboratory'
  private p1Model?: P1SelectionModel
  private jobs!: GenerationJobs
  private p1Offline = false
  private lastActivity = 0
  private idleLabel?: Phaser.GameObjects.Text
  private stageBackdrop?: Phaser.GameObjects.Image
  private attract?: Phaser.GameObjects.DOMElement
  private attractInputConsumed = false
  private attractPadButtons = new Set<string>()
  private audio?: GameAudio
  private readonly controls = loadProfiles()
  private readonly padProfiles = loadPadProfiles()
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
  private get screen(): Phaser.GameObjects.Container | undefined { return this.current?.root }
  private get p1View(): P1SelectView | undefined { return this.current instanceof SelectScreen ? this.current.view : undefined }
  private get stage() { return this.current instanceof ArenaScreen ? this.current.stage : undefined }

  create(): void {
    this.audio = new GameAudio(this, this.ui.events)
    this.screenContext = { scene: this, ui: this.ui, audio: this.audio, go: (state) => this.appStateMachine.transitionTo(state), register: (group, id, object, activate, enabled) => this.register(group, id, object, activate, enabled) }
    this.jobs = new GenerationJobs(this, (owner, generatedId, template) => {
      const selected = this.flow.players[owner]
      if (selected?.characterId === `body-0${template}`) this.flow.setPlayers({ ...this.flow.players, [owner]: { ...selected, characterId: generatedId } })
      // 等待畫面上的模板預覽換成剛生成的角色。
      if (this.appStateMachine.getCurrentState() === AppState.LOADING) this.render(AppState.LOADING)
    })
    this.selectedStageId = resolveStageAsset(this.persistence?.context.snapshot.selectedStageId).id
    this.input.mouse?.disableContextMenu()
    this.input.on('pointermove', this.noteActivity); this.input.on('pointerdown', this.noteActivity)
    if (typeof window !== 'undefined') this.inputManager.attachKeyboard(window)
    this.inputManager.setCombatBindings(this.controls); this.inputManager.setPadBindings(this.padProfiles)
    // 所有權以每幀輪詢為準；連線事件只算操作，重設閒置計時。
    window.addEventListener('gamepadconnected', this.noteActivity); window.addEventListener('gamepaddisconnected', this.noteActivity)
    this.input.keyboard?.on('keydown', this.attractKey); this.noteActivity()
    this.clock.start()
    void this.flow.refreshLeaderboard()
    this.flow.onOffline = () => { this.p1Offline = true; this.p1View?.setOffline() }
    this.flow.onResultStored = () => this.render(this.appStateMachine.getCurrentState())
    // 轉移副作用（session／match／persistence）由 ExperienceFlow 先處理；這裡只管呈現。
    this.unsubscribe = this.appStateMachine.subscribe(({ previousState, nextState }) => {
      if (nextState === AppState.BATTLE) this.audio?.loop('amb-cheer')
      if (previousState === AppState.BATTLE && nextState === AppState.PRESENTATION && this.flow.result) {
        this.audio?.playSequence(combatCues(this.tickEvents.splice(0)))
        this.audio?.playSequence(finishCues(this.flow.result, Boolean(this.flow.players.P2), this.flow.match.world.getConfig().maxHp, this.flow.match.getRoundSummaries().at(-1)))
        this.audio?.play({ id: 'amb-claps' })
      }
      if (previousState === AppState.BATTLE && nextState !== AppState.PRESENTATION) this.audio?.stopLoop()
      if (previousState === AppState.PRESENTATION) this.audio?.stopLoop()
      if (nextState === AppState.READY) { this.p1Offline = false; this.p1Model = undefined; this.clearGeneration(); void this.refreshGeneratedEntries() }
      if (nextState === AppState.IDLE) this.clearGeneration()
      if (previousState === AppState.READY) this.p1Model = undefined
      this.lastActivity = this.time.now
      if (nextState !== AppState.IDLE) { this.stopAttract(); this.closeControls(); this.closeBoard() }
      if (nextState === AppState.BATTLE) { this.tickEvents = []; this.combatUnsubscribe?.(); this.combatUnsubscribe = this.flow.match.world.subscribe((event) => { this.tickEvents.push(event) }) }
      this.render(nextState)
    })
    this.clockUnsubscribe = this.clock.subscribe(() => {
      const state = this.appStateMachine.getCurrentState()
      if (state === AppState.PRESENTATION || state === AppState.LOADING) { this.current?.tick(); return }
      if (state !== AppState.BATTLE) return
      const input = this.inputManager.consumeGameplaySnapshot(), p2 = this.inputManager.consumeGameplaySnapshot('P2')
      // 蹲是純呈現：只在可操作時顯示（起手序列與回合結束停留不蹲）；ENEMY 只有 2P 真人時才看 2P 的蹲鍵。
      const fighting = this.flow.match.getSnapshot().matchState === 'FIGHTING'
      this.playerContext.crouch = fighting && input.crouchHeld
      this.enemyContext.crouch = fighting && Boolean(this.flow.players.P2) && p2.crouchHeld
      this.flow.tick(intentFromInput(input), intentFromInput(p2))
      if (this.appStateMachine.getCurrentState() === AppState.BATTLE) this.current?.tick()
    })
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', ({ screen }) => { if (screen === AppState.BATTLE && this.current instanceof BattleScreen) return; this.render(this.appStateMachine.getCurrentState()) }))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', ({ open }) => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) { this.render(this.appStateMachine.getCurrentState()); return }
      if (open) { this.clock.pause(); this.anims.pauseAll() } else { this.clock.resume(); this.anims.resumeAll() }
      if (open) this.audio?.pauseLoop(); else this.audio?.resumeLoop()
      this.stage?.pause(open)
      // Keep fighter interpolation history intact while opening or closing the menu.
      this.overlay?.destroy(); this.overlay = undefined
      if (open) this.openOverlay()
    }))
    this.uiUnsubscribers.push(this.ui.events.on('FOCUS_CHANGED', ({ previous, next }) => { this.buttons.get(previous ?? '')?.setFocused(false); this.buttons.get(next ?? '')?.setFocused(true) }))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyScene())
    this.render(this.appStateMachine.getCurrentState())
  }

  update(time: number, delta: number): void {
    // 保留 null：陣列位置就是 Gamepad.index，玩家依所有權對應手把。
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [], lostPad = this.inputManager.update(gamepads).some((id) => id === 'P1' || Boolean(this.flow.players.P2))
    const padButtons = new Set(gamepads.flatMap((pad, p) => pad ? pad.buttons.flatMap((button, b) => button.pressed || button.value >= 0.5 ? [`${p}:${b}`] : []) : []))
    if ([...padButtons].some(button => !this.attractPadButtons.has(button))) {
      this.lastActivity = time
      if (this.attract) { this.stopAttract(); this.attractInputConsumed = true }
    }
    this.attractPadButtons = padButtons
    const visualState = this.appStateMachine.getCurrentState(), battling = visualState === AppState.BATTLE, practicing = visualState === AppState.LOADING, pausedBefore = this.clock.isPaused()
    // P1／P2 逐層返回；P3／P5／P6 返回主畫面（backRoutes）。
    const backScreen = ([AppState.READY, AppState.SETUP, AppState.LOADING, AppState.PRESENTATION, AppState.RESULT] as AppStateValue[]).includes(visualState)
    const allOwned = this.inputManager.consumeOwnedUiActions(), allActions = this.inputManager.consumeUiActions()
    if (allOwned.length || allActions.length) this.lastActivity = time
    // 打字時只擋鍵盤（字母鍵也是選單鍵）；手把不會打字，暱稱框 focus 時仍要能確認／取消。
    const typing = document.activeElement instanceof HTMLInputElement, pause = this.inputManager.consumePause()
    const owned = typing ? allOwned.filter(({ device }) => device) : allOwned, actions = typing ? [] : allActions, p1Owned = owned.filter(({ owner }) => owner === 'P1').map(({ action }) => action)
    if (this.attract || this.attractInputConsumed || this.controlsPanel || this.boardPanel) {
      // 開頭動畫、操作設定或排行榜開啟中：UI 輸入不穿透到 P0；1P（含手把）的 BACK／CONFIRM 可關閉排行榜。
      if (this.boardPanel && [...actions, ...p1Owned].some((action) => action === 'BACK' || action === 'CONFIRM')) this.closeBoard()
      // 面板開啟時鍵盤由面板自己攔截；這裡把兩位玩家手把的選單動作都交給面板。
      this.controlsPanel?.updatePad(owned.filter(({ device }) => device))
    } else if (visualState === AppState.IDLE && (this.inputManager.controlsPress('P1') || this.inputManager.controlsPress('P2'))) {
      this.openControls()
    } else if (visualState === AppState.READY && this.p1Model) {
      const captureOwner = this.p1Model.phase === 'CUSTOMIZE' ? this.p1Model.owner : undefined
      if (captureOwner) {
        const attack = this.inputManager.consumeGameplaySnapshot(captureOwner)
        const lightPunch = attack.attackPressed && attack.attack === 'LIGHT_PUNCH'
        const confirmQueued = owned.some((input) => input.owner === captureOwner && input.action === 'CONFIRM')
        if (lightPunch && !confirmQueued) this.p1Input(captureOwner, 'CONFIRM')
        const skip = attack.attackPressed && this.inputManager.lastDevice() === 'keyboard' && attack.attack === 'LIGHT_KICK'
        if (skip) { this.p1Model.skipCustomize(); this.syncP1() }
      }
      for (const owner of ['P1', 'P2'] as const) if (this.inputManager.deletePress(owner) && this.p1Model.phase === 'GRID') this.requestDelete(this.p1Model.player(owner).cursor)
      // 拍照／確認照片時 Enter（離開名字框後）與手把 START 也算確認：手把 ✕ 在這頁要留給螢幕鍵盤打字。
      const flowOwner = this.p1Model.phase === 'CUSTOMIZE' || this.p1Model.phase === 'REVIEW' ? this.p1Model.owner : undefined
      const startPressed = actions.includes('CONFIRM') || (pause && this.inputManager.lastDevice() === 'gamepad')
      if (flowOwner && startPressed && !this.p1View?.exitOpen && !owned.some((input) => input.owner === flowOwner && input.action === 'CONFIRM')) this.p1Input(flowOwner, 'CONFIRM')
      // P1 由 1P/2P 擁有者鍵位操作；未標記輸入只保留 Esc（選角中返回標題）。
      if (this.p1View?.exitOpen) this.p1View.handleExit([...actions, ...p1Owned])
      else if (actions.includes('BACK')) {
        if (this.p1Model.owner) this.p1View?.confirmExit(() => { this.p1Model?.abortCustomize(); this.syncP1() })
        else this.ui.navigation.dispatch('BACK')
      } else owned.forEach(({ owner, action, device }) => {
        // 手把只有一顆返回鍵：1P 在最上層（未鎖定）時等同鍵盤 Esc，回到標題。
        if (device && this.p1View?.nameKey(owner, action)) this.noteActivity()
        else if (device && owner === 'P1' && action === 'BACK' && this.p1Model?.phase === 'GRID' && this.p1Model.player('P1').locked === undefined) this.ui.navigation.dispatch('BACK')
        else this.p1Input(owner, action)
      })
    } else if (battling && !this.ui.navigation.isOverlayOpen()) {
      // P4 未暫停：只看 Combat profile 的 PAUSE，選單鍵不作用；暫停後才交給選單鍵。本場操作者（1P，雙人時含 2P）的手把斷線也暫停。
      if (pause || lostPad) this.ui.navigation.dispatch('OPEN_MENU')
    } else if (practicing) {
      // P3 練習：READY 前 FIGHT! 停用，確認鍵（F／手把 ✕）只是練習出招；READY 後確認鍵、Enter、手把 START 都開戰。返回＝Esc 或手把返回鍵。
      const menu = [...actions, ...owned.filter(({ owner, device, action }) => owner === 'P1' && (action === 'CONFIRM' || (device && action === 'BACK'))).map(({ action }) => action)]
      if (pause && this.inputManager.lastDevice() === 'gamepad') menu.push('CONFIRM')
      menu.filter((action) => action === 'CONFIRM' || action === 'BACK').forEach((action) => this.ui.navigation.dispatch(action))
    } else {
      // 暫停選單只屬於 P4；其他畫面的 Escape／M 不開啟選單。
      // 1P 選單鍵（鍵盤跟自訂鍵位，或 1P 的手把）在後續選單同樣有效；2P 的鍵盤與手把都不併入（2P 鍵與未標記鍵重複，會重複觸發）。
      actions.push(...p1Owned)
      actions.filter((action) => !this.current?.handleAction(action)).filter((action) => this.ui.navigation.isOverlayOpen() || battling || (action === 'BACK' && backScreen) || (action !== 'OPEN_MENU' && action !== 'BACK')).forEach((action) => { if (!this.overlay?.inputLocked) this.ui.navigation.dispatch(action) })
    }
    this.attractInputConsumed = false
    this.checkIdle(time)
    // 選單或暫停中的跳躍／攻擊按下不留到戰鬥（手把 A／B 同時是確認／返回與輕踢／重踢）；關閉暫停的那一下也算選單輸入。
    if ((!battling && !practicing) || pausedBefore || this.clock.isPaused()) { this.inputManager.consumeGameplaySnapshot(); this.inputManager.consumeGameplaySnapshot('P2') }
    this.clock.advance(delta)
    this.current?.update(delta)
  }

  /** 換畫面：銷毀前一個畫面（連同它的物件、動畫與焦點），依狀態對照表建立新畫面。 */
  private render(state: AppStateValue): void {
    this.overlay?.destroy(); this.overlay = undefined
    this.current?.destroy(); this.current = undefined
    this.buttons.clear(); this.idleLabel = undefined; this.stageBackdrop = undefined
    document.body.style.setProperty('--backdrop', `url("${resolveStageAsset(this.selectedStageId).url}")`)
    const root = this.add.container(0, 0).setAlpha(reducedMotion ? 1 : 0)
    this.addBackground(root, state)
    const ctx = this.screenContext
    const screens: Record<AppStateValue, () => ScreenView> = {
      [AppState.IDLE]: () => new HomeScreen(ctx, root, `${keyLabel(this.controls.P1.LIGHT_PUNCH)} / ENTER / ${this.padConfirm()} 確認 · ← → 切換 · P 播放開頭動畫 · C / ${padLabel(PAD_SYSTEM.CONTROLS)} 操作設定`, () => this.openBoard()),
      [AppState.READY]: () => new SelectScreen(ctx, root, this.jobs.entriesReady ? (parent) => this.createP1View(parent) : undefined),
      [AppState.SETUP]: () => new StageSelectScreen(ctx, root, this.selectedStageId, this.stepTotal(), (id) => this.selectStage(id), () => this.confirmStage()),
      [AppState.LOADING]: () => new LoadingScreen(ctx, root, { matchup: this.matchup(), controls: this.controls, pads: this.padProfiles, input: this.inputManager, clock: this.clock, jobs: this.jobs, retry: () => this.jobs.retry(this.selectedCharacterIds(), [this.playerSpriteId(), this.enemySpriteId()]) }),
      [AppState.BATTLE]: () => new BattleScreen(ctx, root, this.matchup(), this.flow, { input: this.inputManager, clock: this.clock, takeEvents: () => this.tickEvents.splice(0), playerContext: this.playerContext, enemyContext: this.enemyContext }),
      [AppState.PRESENTATION]: () => new PresentationScreen(ctx, root, this.matchup(), this.flow),
      [AppState.RESULT]: () => new ResultScreen(ctx, root, this.flow.result && resultViewModel(this.flow.result, this.persistence?.context.snapshot.backendRank ?? null, p6SubStateForRank(this.persistence?.context.snapshot.backendRank), this.flow.leaderboard, this.persistence?.context.snapshot.sessionId)),
      [AppState.END]: () => new EndScreen(ctx, root, endViewModel(this.flow.nextPlayerName)),
    }
    this.current = screens[state]()
    if (this.ui.navigation.isOverlayOpen()) this.openOverlay()
  }

  private addBackground(container: Phaser.GameObjects.Container, state: AppStateValue): void {
    if (state === AppState.LOADING || state === AppState.BATTLE || state === AppState.PRESENTATION) return
    const darkness = state === AppState.IDLE ? uiTokens.backdrop.empty : state === AppState.END ? uiTokens.backdrop.end : state === AppState.RESULT ? uiTokens.backdrop.result : uiTokens.backdrop.content
    const cover = aspectCover(2752, 1536, uiTokens.logicalWidth, uiTokens.logicalHeight)
    this.stageBackdrop = this.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(this.selectedStageId)).setDisplaySize(cover.width, cover.height)
    container.add(this.stageBackdrop)
    addAtmosphere(this, container, darkness)
  }
  private register(group: string, id: string, object: Focusable, activate: () => void, enabled = true): void {
    this.buttons.set(id, object); this.ui.focus.register(group, id, enabled, activate)
    object.on('pointerover', () => { if (this.overlay?.inputLocked) return; if (object.input?.enabled && this.ui.focus.current() !== id) this.ui.focus.activate(group, id) })
  }
  private openOverlay(): void {
    if (!this.screen) return
    this.overlay = new PauseOverlay(this.screenContext, this.screen, `ENTER / ${this.padConfirm()} 確認 ・ ESC / ${padLabel(PAD_SYSTEM.BACK)} 返回`, () => { this.flow.restartMatch(); this.current?.tick() })
  }

  /** 選單只認 1P：手把確認鍵＝1P 的輕踢鍵（預設 ✕）。 */
  private padConfirm(): string { return padLabel(this.padProfiles.P1.LIGHT_KICK) }
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

  private createP1View(root: Phaser.GameObjects.Container): P1SelectView {
    this.p1Model ??= new P1SelectionModel([...characterEntries(), ...this.jobs.entries], { players: this.flow.players, faceGenUsed: this.persistence?.context.snapshot.faceGenUsed })
    ;(['P1', 'P2'] as const).forEach((owner) => { const index = this.p1Model?.heroSlot(owner)?.index; if (index) void this.loadRosterPreview(index) })
    void loadHeads(this, this.p1Model.slots.flatMap((slot) => slot.entry ? [slot.entry] : []), () => this.p1View?.refreshHeads())
    return new P1SelectView(this, root, this.p1Model, {
      offline: this.p1Offline || this.persistence?.lastLeaderboardOk === false,
      onInput: (owner, action) => this.p1Input(owner, action),
      onDelete: (index) => this.requestDelete(index),
      onFocus: (owner, index) => { if (this.p1Model?.focus(owner, index)) { this.p1View?.sync(); void this.loadRosterPreview(index) } },
      onNickname: (owner, name) => { this.p1Model?.setNickname(owner, name); this.lastActivity = this.time.now },
      onSkip: () => { this.p1Model?.skipCustomize(); this.syncP1() },
      onAllReady: () => this.confirmPlayers(),
    })
  }
  private p1Input(owner: PlayerSlotId, action: OwnedUiAction): void {
    if (this.p1View?.exitOpen) return
    this.noteActivity()
    const model = this.p1Model, phase = model?.phase
    if (phase === 'CUSTOMIZE' && model?.owner === owner && action === 'CONFIRM' && model.player(owner).faceGenUsed) { this.p1View?.feedback(owner, 'FACE_GENERATION_USED'); return }
    this.p1View?.captureOnConfirm(owner, action)
    if (phase === 'CUSTOMIZE' && model?.owner === owner && action === 'CONFIRM' && model.nicknameValid(owner) && !model.player(owner).photo) { this.p1View?.cameraUnavailable(); return }
    const result = this.p1Model?.input(owner, action)
    if (phase === 'REVIEW' && result === 'CONFIRMED') this.persistence?.markFaceGenUsed(owner)
    if (this.jobs.has(owner) && this.p1Model?.player(owner).locked === undefined) this.jobs.cancel(owner)
    if (this.p1Model?.phase === 'PROCESSING' && this.p1Model.owner === owner && result === 'CONFIRMED') {
      const player = this.p1Model.player(owner), template = player.locked
      if (player.photo && template) {
        this.jobs.start(owner, player.nickname.trim(), template, player.photo)
        this.p1Model.continueProcessing()
      }
    }
    if (action !== 'CONFIRM' || result === 'CONFIRMED') this.audio?.ui(action)
    if (result && result !== 'CONFIRMED') this.p1View?.feedback(owner, result)
    this.syncP1()
    const index = this.p1Model?.heroSlot(owner)?.index
    if (index) void this.loadRosterPreview(index)
  }
  /** 右鍵／R2：只有選角總覽階段、沒被任何玩家鎖定的已生成角色可以刪；先跳確認框（預設取消）。 */
  private requestDelete(index: number): void {
    const model = this.p1Model, entry = model?.slot(index).entry
    if (!model || model.phase !== 'GRID' || this.p1View?.exitOpen || !entry?.generationId) return
    if (model.player('P1').locked === index || model.player('P2').locked === index) return
    this.p1View?.confirmExit(() => { void this.deleteCharacter(index) }, `DELETE ${entry.displayName.slice(0, 12)}? · 刪除角色？`, '會永久刪除這個角色的素材資料夾，無法復原')
  }
  private async deleteCharacter(index: number): Promise<void> {
    const entry = this.p1Model?.slot(index).entry, spriteId = entry?.spriteId
    if (!entry?.generationId || !spriteId) return
    // 刪除失敗（例如資料夾已被別處刪掉）也一樣重新讀名冊，畫面以後端實際內容為準。
    await deleteGeneratedCharacter(entry.generationId).catch(() => undefined)
    await this.jobs.refreshEntries()
    dropGeneratedTextures(this, spriteId); dropHead(this, spriteId)
    const cursors = (['P1', 'P2'] as const).map((owner) => this.p1Model?.player(owner).cursor ?? 5)
    this.p1Model = undefined; this.render(AppState.READY)
    ;(['P1', 'P2'] as const).forEach((owner, i) => this.p1Model?.focus(owner, Math.min(cursors[i], Math.max(...this.p1Model.slots.filter((slot) => slot.entry).map((slot) => slot.index)))))
    this.syncP1()
  }
  private async refreshGeneratedEntries(): Promise<void> {
    await this.jobs.refreshEntries()
    if (this.appStateMachine.getCurrentState() === AppState.READY && !this.p1Model) this.render(AppState.READY)
  }
  private async loadRosterPreview(index: number): Promise<void> {
    const entry = this.p1Model?.slot(index).entry, sprite = entry?.spriteId
    if (sprite && sprite in alignedSprites) { try { await loadHdSprite(this, sprite as AlignedSpriteId, true); this.p1View?.sync() } catch { /* 原圖載入失敗就繼續用精簡版預覽。 */ } return }
    if (!entry?.generationId || !entry.spriteId || this.textures.exists(`${entry.spriteId}-idle`)) return
    try { await this.jobs.load(entry.generationId, true); this.p1View?.sync() } catch { /* The battle loading screen reports missing assets. */ }
  }
  private clearGeneration(): void {
    this.jobs.clear()
    ;(['P1', 'P2'] as const).forEach((id) => { const key = faceKey(id); if (this.textures.exists(key)) this.textures.remove(key) })
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
    ;(['P1', 'P2'] as const).forEach((id) => { const assetId = this.jobs.assetId(id); if (assetId && players[id]) players[id] = { ...players[id], characterId: `generated-${assetId}` } })
    this.flow.setPlayers(players); this.flow.opponent = this.p1Model.opponent()
    this.applyFaces()
    // 原圖若在進 P3 之後才載完，重畫一次練習場讓角色換成清楚版。
    void this.jobs.loadSelected(this.selectedCharacterIds(), [this.playerSpriteId(), this.enemySpriteId()]).then(() => { if (this.appStateMachine.getCurrentState() === AppState.LOADING) this.render(AppState.LOADING) })
    this.appStateMachine.transitionTo(AppState.SETUP)
  }
  private selectedCharacterIds(): Array<string | undefined> { return Object.values(this.flow.players).map((player) => player?.characterId) }
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
        context.lineWidth = 12; context.strokeStyle = colorHex('focus'); context.stroke()
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
    if (!this.idleLabel) { this.idleLabel = this.add.text(960, 42, '', { ...typography.note, fontSize: uiTokens.type.label, color: colorHex('resultGold') }).setOrigin(0.5); this.screen?.add(this.idleLabel) }
    this.idleLabel.setText(idle >= limit - 10000 ? `閒置倒數 ${Math.max(0, Math.ceil((limit - idle) / 1000))}s · 操作以繼續` : '')
    if (idle < limit) return
    this.noteActivity()
    if (state === AppState.READY && this.p1Model?.owner) { this.p1Model.abortCustomize(); this.syncP1() }
    else this.ui.navigation.dispatch('FINISH')
  }

  private selectStage(id: StageId): void {
    this.selectedStageId = id; this.persistence?.context.set({ selectedStageId: id })
    this.stageBackdrop?.setTexture(stageTextureKey(id))
    document.body.style.setProperty('--backdrop', `url("${resolveStageAsset(id).url}")`)
  }
  private confirmStage(): void { this.persistence?.context.set({ selectedStageId: this.selectedStageId }); this.appStateMachine.transitionTo(AppState.LOADING) }

  /** 流程總步數：選角（含拍照、1P 選對手）＋選場景。 */
  private stepTotal(): number { return this.hasCustom() ? 4 : 3 }
  private hasCustom(): boolean { return Object.values(this.flow.players).some((player) => characterEntry(player?.characterId)?.type === 'BODY_TEMPLATE') }
  private matchup(): Matchup { return { player: this.playerEntry(), playerName: this.playerName(), enemyName: this.enemyName(), playerSprite: sharpSprite(this.playerSpriteId()), enemySprite: sharpSprite(this.enemySpriteId()), twoPlayer: Boolean(this.flow.players.P2), stageId: this.selectedStageId } }
  private playerEntry(): CharacterEntry { return this.rosterEntry(this.flow.players.P1?.characterId) ?? testCharacterManifest.presetA }
  private playerName(): string { return this.flow.players.P1?.nickname || this.playerEntry().displayName }
  // 單人：ENEMY 為選定的 CPU 對手；雙人：ENEMY 為 2P 的選擇，由 2P 操作。
  private rosterEntry(id: string | undefined): CharacterEntry | undefined { return characterEntry(id) ?? this.jobs.entries.find((entry) => entry.id === id) }
  private opponentEntry(): CharacterEntry | undefined { return this.flow.players.P2 ? undefined : this.rosterEntry(this.flow.opponent?.characterId) }
  private enemyName(): string { const p2 = this.flow.players.P2; if (!p2 && this.opponentEntry()) return this.opponentEntry()?.displayName ?? 'ROG_SAGA'; return p2 ? p2.nickname || this.rosterEntry(p2.characterId)?.displayName || 'ROG_SAGA' : 'ROG_SAGA' }
  private playerSpriteId(): SpriteId | undefined { const assetId = this.jobs.assetId('P1'); return assetId ? `generated-${assetId}` : this.playerEntry().spriteId }
  private enemySpriteId(): SpriteId { const assetId = this.jobs.assetId('P2'); return assetId ? `generated-${assetId}` : this.opponentEntry()?.spriteId ?? characterEntry(this.flow.players.P2?.characterId)?.spriteId ?? (this.playerSpriteId() === 'go' ? 'chris' : 'go') }

  private readonly attractKey = (event: KeyboardEvent): void => {
    if (this.appStateMachine.getCurrentState() !== AppState.IDLE || event.repeat) return
    if (this.controlsPanel || this.boardPanel) return
    if (this.attract) { this.stopAttract(); this.attractInputConsumed = true; return }
    this.noteActivity()
    if (event.code === 'KeyP') this.playAttract()
    else if (event.code === 'KeyC' && !this.attract) this.openControls()
  }
  /** 鍵盤 C 或 1P 手把 L3 開啟；1P 已擁有手把（L3 開啟時必然如此）就先顯示 GAMEPAD 分頁。 */
  private openControls(): void {
    const pad = { profiles: this.padProfiles, onSave: (profiles: PadProfiles) => { savePadProfiles(profiles); this.inputManager.setPadBindings(profiles) }, input: this.inputManager }
    const device = this.inputManager.padOwner('P1') === undefined ? 'KEYBOARD' : 'GAMEPAD'
    this.controlsPanel = new ControlsPanel(this, this.controls, (profiles) => { saveProfiles(profiles); this.inputManager.setCombatBindings(profiles) }, pad, () => { this.closeControls(); this.render(AppState.IDLE) }, device) // 重繪 P0：提示鍵名跟著新鍵位
    this.noteActivity()
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
  private destroyScene(): void {
    this.clearGeneration(); this.audio?.destroy(); this.audio = undefined; this.stopAttract(); this.closeControls(); this.closeBoard(false)
    this.input.keyboard?.off('keydown', this.attractKey); window.removeEventListener('gamepadconnected', this.noteActivity); window.removeEventListener('gamepaddisconnected', this.noteActivity)
    this.overlay?.destroy(); this.overlay = undefined; this.current?.destroy(); this.current = undefined
    this.input.off('pointermove', this.noteActivity); this.input.off('pointerdown', this.noteActivity)
    this.combatUnsubscribe?.(); this.unsubscribe?.(); this.clockUnsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()); this.inputManager.detachKeyboard(); this.clock.stop()
  }
}
