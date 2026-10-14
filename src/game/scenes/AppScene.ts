import Phaser from 'phaser'
import { AppState, type AppState as AppStateValue } from '../state/AppState'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { UIFramework } from '../ui/UIFramework'
import { ActionButton, addFocalGlow, AngularPanel, AnnouncerText, CharacterCard, fighterSilhouette, HealthBar, StageCard } from '../ui/VisualComponents'
import { stopOwnedTweens } from '../ui/tweens'
import { uiTokens, colorHex } from '../ui/tokens/uiTokens'
import { aspectCover } from '../ui/tokens/layout'
import { typography } from '../ui/tokens/typography'
import { InputManager } from '../input/InputManager'
import { GameClock } from '../time/GameClock'
import { intentFromInput, type CombatEvent } from '../combat/CombatWorld'
import { MatchController, type MatchSnapshot } from '../match/MatchController'
import { p6SubStateForRank, resolveMatchResult, type MatchResult, type P6SubState } from '../match/ResultResolver'
import type { ExperiencePersistence } from '../app/ExperiencePersistence'
import type { LeaderboardEntry } from '../api/ApiTypes'
import { characterChoices, characterSelectViewModel, battleViewModel, endViewModel, loadingViewModel, mockResultViewModel, p0Variant, presentationViewModel, recordWallViewModel, resultViewModel, stageSelectViewModel, type P5ShowcaseVariant, type ResultViewModel } from '../ui/ViewModels'
import { resolveStageAsset, testStageManifest, type StageId } from '../ui/assets/TestAssetManifest'
import { animationCategories, existingAnimationEntries, sampleCharacterAnimationManifest } from '../ui/animation/FighterAnimationManifest'
import { FighterVideoRenderer } from '../ui/animation/FighterVideoRenderer'
import { TemporarySpriteRenderer } from '../ui/animation/TemporarySpriteRenderer'
import { spriteActions, spriteFrameCount, spriteFrameUrl, spriteIds, spriteTextureKey, type SpriteId } from '../ui/animation/TemporarySpriteManifest'
import { sampleWebmValidation } from '../ui/assets/sampleWebmValidation'

type Focusable = { setFocused: (focused: boolean) => unknown }
const stageTextureKey = (id: StageId): string => `stage-${id}`

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
  private readonly match = new MatchController()
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
  private battleInfo?: Phaser.GameObjects.Text
  private battleTimer?: Phaser.GameObjects.Text
  private battleCombo?: Phaser.GameObjects.Text
  private battleDanger?: Phaser.GameObjects.Text
  private battleFirstAttack?: Phaser.GameObjects.Text
  private battleAnnouncer?: AnnouncerText
  private battlePlayerBar?: HealthBar
  private battleEnemyBar?: HealthBar
  private battlePlayerRoundMarkers: Phaser.GameObjects.Arc[] = []
  private battleEnemyRoundMarkers: Phaser.GameObjects.Arc[] = []
  private battleRoot?: Phaser.GameObjects.Container
  private selectedCharacterId = 'preset-a'
  private selectedStageId: StageId = 'laboratory'
  private showcaseEnabled = false
  private assetsLoaded = false
  private showcaseState?: AppStateValue
  private showcaseLab = false
  private labIndex = 0
  private labFacing: 'LEFT' | 'RIGHT' = 'RIGHT'
  private labHud = true
  private labLoop = true
  private showcaseAnnouncer = false
  private showcaseBattleVariant: 'NORMAL' | 'COMBO' | 'DANGER' | 'LAST_10_SECONDS' = 'NORMAL'
  private showcaseP0Variant: 'EMPTY' | 'RECORDS_1_TO_4' | 'RECORDS_5_PLUS' = 'EMPTY'
  private showcaseP5Variant: P5ShowcaseVariant = 'KO'
  private showcaseP6SubState: P6SubState = 'RANK_1_TO_6'
  private characterHero?: Phaser.GameObjects.Container
  private characterHeroTitle?: Phaser.GameObjects.Text
  private characterPreview?: Phaser.GameObjects.Image | Phaser.GameObjects.Video
  private characterHeroFallback?: Phaser.GameObjects.Graphics
  private characterNickname?: Phaser.GameObjects.Text
  private labRenderer?: FighterVideoRenderer
  private readonly showcaseListeners: Array<{ event: string; listener: () => void }> = []

  constructor(appStateMachine: AppStateMachine, ui: UIFramework, persistence?: ExperiencePersistence) {
    super('AppScene'); this.appStateMachine = appStateMachine; this.ui = ui; this.persistence = persistence
  }

  create(): void {
    const context = this.persistence?.context.snapshot
    this.selectedCharacterId = context?.selectedCharacterId ?? 'preset-a'; this.selectedStageId = resolveStageAsset(context?.selectedStageId).id
    if (typeof window !== 'undefined') this.inputManager.attachKeyboard(window)
    if (import.meta.env.DEV && typeof window !== 'undefined') { const params = new URLSearchParams(window.location.search); this.showcaseEnabled = params.get('uiShowcase') === '1'; if (this.showcaseEnabled) this.showcaseState = AppState.IDLE }
    this.load.image(stageTextureKey('laboratory'), testStageManifest.laboratory.url)
    this.load.image(stageTextureKey('company-building'), testStageManifest['company-building'].url)
    spriteIds.forEach((id) => spriteActions.forEach((action) => { for (let frame = 0; frame < spriteFrameCount(action); frame += 1) this.load.image(spriteTextureKey(id, action, frame), spriteFrameUrl(id, action, frame)) }))
    this.load.once('complete', () => { this.assetsLoaded = true; this.render(this.appStateMachine.getCurrentState()) })
    this.load.start(); this.clock.start()
    void this.persistence?.leaderboard().then((entries) => { this.leaderboardEntries = entries; if (!this.showcaseState) this.ui.substates.set(AppState.IDLE, p0Variant(entries.length)); if (this.appStateMachine.getCurrentState() === AppState.IDLE && !this.showcaseState) this.render(AppState.IDLE) })
    this.unsubscribe = this.appStateMachine.subscribe(({ previousState, nextState }) => {
      if (nextState === AppState.READY) void this.persistence?.ensureSession().catch(() => this.ui.substates.set(AppState.READY, 'FALLBACK'))
      // P4 暫停離開與 P7 Finish 都結束 session；後端會把未完成的對戰標為 ABANDONED。
      if ((previousState === AppState.END || previousState === AppState.BATTLE) && nextState === AppState.IDLE) void this.persistence?.finishSession().catch(() => undefined)
      if (nextState === AppState.BATTLE) { this.match.start(); this.tickEvents = []; this.firstHit = undefined; this.combatUnsubscribe?.(); this.combatUnsubscribe = this.match.world.subscribe((event) => { this.tickEvents.push(event) }); void this.persistence?.beginMatch().catch(() => undefined) }
      if (nextState === AppState.SETUP || nextState === AppState.IDLE) { this.match.resetMatch(); this.persistence?.resetMatch(); this.resolvedResult = undefined; this.nextPlayerName = undefined }
      this.render(nextState)
    })
    this.clockUnsubscribe = this.clock.subscribe(() => {
      if (this.appStateMachine.getCurrentState() !== AppState.BATTLE) return
      this.match.tick(intentFromInput(this.inputManager.consumeGameplaySnapshot())); void this.persistence?.recordRounds(this.match.getRoundSummaries()).catch(() => undefined)
      const snapshot = this.match.getSnapshot(); this.ui.substates.set(AppState.BATTLE, this.match.getP4SubState()); this.updateBattle(snapshot)
      const completed = this.match.getCompletedMatch()
      if (completed && !this.resolvedResult) { this.resolvedResult = resolveMatchResult(completed); void this.persistence?.finishMatch(this.resolvedResult).then(async (stored) => { this.ui.substates.set(AppState.RESULT, p6SubStateForRank(stored?.rank ?? this.persistence?.context.snapshot.backendRank)); this.leaderboardEntries = await this.persistence?.leaderboard() ?? []; this.nextPlayerName = await this.persistence?.nextQueuedPlayer(); this.render(this.appStateMachine.getCurrentState()) }).catch(() => undefined); this.appStateMachine.transitionTo(AppState.PRESENTATION) }
    })
    this.uiUnsubscribers.push(this.ui.events.on('SUBSTATE_CHANGED', ({ screen }) => { if (screen === AppState.BATTLE && this.battleRoot && !this.showcaseState) return; this.render(this.appStateMachine.getCurrentState()) }))
    this.uiUnsubscribers.push(this.ui.events.on('OVERLAY_CHANGED', ({ open }) => { if (this.appStateMachine.getCurrentState() === AppState.BATTLE) { if (open) this.clock.pause(); else this.clock.resume() }; this.render(this.appStateMachine.getCurrentState()) }))
    this.uiUnsubscribers.push(this.ui.events.on('FOCUS_CHANGED', ({ group, previous, next }) => { this.buttons.get(previous ?? '')?.setFocused(false); this.buttons.get(next ?? '')?.setFocused(true); if (group === 'character' && next?.startsWith('character-') && next !== 'character-confirm') this.updateCharacterPreview(next.slice('character-'.length)) }))
    if (import.meta.env.DEV && this.showcaseEnabled) { this.installShowcaseKeys(); this.installShowcaseP5Keys(); this.installShowcaseRankKeys() }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyScene())
    if (!this.load.isLoading()) { this.assetsLoaded = true; this.render(this.appStateMachine.getCurrentState()) }
  }

  update(_time: number, delta: number): void { const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => pad !== null) : []; this.inputManager.update(gamepads)
    const battling = this.appStateMachine.getCurrentState() === AppState.BATTLE
    const menuScreen = !this.showcaseLab && (this.showcaseState ?? this.appStateMachine.getCurrentState()) === AppState.BATTLE
    // 暫停選單只屬於 P4；其他畫面的 Escape／M 不開啟選單。
    this.inputManager.consumeUiActions().filter((action) => this.ui.navigation.isOverlayOpen() || menuScreen || (action !== 'OPEN_MENU' && action !== 'BACK')).forEach((action) => this.ui.navigation.dispatch(action))
    // 選單或暫停中的跳躍／攻擊按下不留到戰鬥（手把 A 同時是 CONFIRM 與 JUMP）。
    if (!battling || this.clock.isPaused()) this.inputManager.consumeGameplaySnapshot()
    this.clock.advance(delta); if (this.appStateMachine.getCurrentState() === AppState.LOADING && this.assetsLoaded && !this.load.isLoading()) this.appStateMachine.transitionTo(AppState.BATTLE) }

  private render(state: AppStateValue, override?: AppStateValue): void {
    if (!this.assetsLoaded && !this.showcaseLab) return
    const visualState = override ?? this.showcaseState ?? state
    this.destroyScreen(); this.screen = this.add.container(0, 0).setAlpha(0); this.addBackground(this.screen, visualState)
    if (this.showcaseLab) { this.renderAnimationLab(); this.addScreenTween({ targets: this.screen, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' }); return }
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
    container.add(this.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(stageId)).setDisplaySize(cover.width, cover.height))
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
  private label(text: string, x: number, y: number, size = 24, color = colorHex('textSecondary')): Phaser.GameObjects.Text { return this.add.text(x, y, text, { ...typography.note, fontSize: `${size}px`, color }).setOrigin(0.5) }
  private register(group: string, id: string, object: Focusable, activate: () => void, enabled = true): void { this.buttons.set(id, object); this.ui.focus.register(group, id, enabled, activate) }
  private addScreenTween(config: Phaser.Types.Tweens.TweenBuilderConfig): void { const tween = this.tweens.add(config); this.screenTweens.push(tween); tween.once('complete', () => { const index = this.screenTweens.indexOf(tween); if (index >= 0) this.screenTweens.splice(index, 1) }) }

  private renderP0(): void {
    const requestedVariant = this.showcaseState === AppState.IDLE ? this.showcaseP0Variant : this.ui.substates.get(AppState.IDLE)
    const showcaseRows = [{ name: 'ROG_Player', score: 1541, maxCombo: 28, title: 'RISING STAR' }, { name: 'Shadow', score: 1469, maxCombo: 21 }, { name: 'Nancy', score: 1397, maxCombo: 18 }, { name: 'Kazu', score: 1325, maxCombo: 16 }, { name: 'Lee', score: 1253, maxCombo: 14 }, { name: 'Chris', score: 1181, maxCombo: 12 }, { name: 'Taro', score: 1109, maxCombo: 10 }, { name: 'Ken', score: 1037 }, { name: 'Kevin', score: 965 }, { name: 'Yuki', score: 893 }]
    const sourceRows = this.leaderboardEntries.map((entry) => ({ name: entry.nickname, score: entry.score, maxCombo: entry.max_combo, title: entry.title }))
    const devRows = import.meta.env.DEV && this.showcaseState ? showcaseRows : []
    const vm = recordWallViewModel(sourceRows.length ? sourceRows : devRows, requestedVariant)
    this.screen?.add(this.heading('FUTURE GAMER 2026'))
    this.screen?.add(this.label(vm.variant === 'EMPTY' ? 'EXPERIENCE 2' : 'PLAYER ACHIEVEMENTS', 960, 166, 25, colorHex('systemBlue')))
    if (vm.variant === 'EMPTY') {
      addFocalGlow(this, this.screen as Phaser.GameObjects.Container, 960, 520, 920, 400, uiTokens.colors.systemBlue, uiTokens.glowAlpha.subtle)
      this.screen?.add(this.add.text(960, 445, 'STEP INTO THE ARENA', { ...typography.title, fontSize: '84px', shadow: { color: colorHex('systemBlue'), blur: uiTokens.shadowBlur.focal, fill: true } }).setOrigin(0.5))
      this.addP0Start(650)
      return
    }
    const rows = vm.rows.map(({ name, score }) => [name, score] as const)
    vm.rows.slice(0, 4).forEach((row, i) => {
      const panel = new AngularPanel(this, 292, 720, uiTokens.colors.panelRaised).setPosition(244 + i * 304, 580)
      const portrait = this.add.graphics().setPosition(0, -112)
      portrait.fillStyle(uiTokens.colors.background1, 0.94).fillRect(-130, -236, 260, 472)
      panel.add(portrait)
      panel.add(fighterSilhouette(this, 0, -110, 220, 320, uiTokens.colors.textPrimary, 0.38))
      const portraitShade = this.add.graphics()
      portraitShade.fillGradientStyle(uiTokens.colors.background0, uiTokens.colors.background0, uiTokens.colors.background0, uiTokens.colors.background0, 0, 0, 0.78, 0.78).fillRect(-130, 20, 260, 104)
      panel.add(portraitShade)
      panel.add(this.add.rectangle(0, 246, 260, 222, uiTokens.colors.background0, 0.92).setStrokeStyle(uiTokens.borderWidth.quiet, uiTokens.colors.lineBright, 0.55))
      panel.add(this.label(String(i + 1).padStart(2, '0'), 112, 159, 17, colorHex('playerGlow')))
      panel.add(this.add.text(0, 162, row.name, { ...typography.secondaryAction, fontSize: '20px', color: colorHex('textPrimary') }).setOrigin(0.5))
      if (row.title) panel.add(this.add.text(0, 196, row.title, { ...typography.note, fontSize: '15px', color: colorHex('resultGold'), fontStyle: 'bold' }).setOrigin(0.5))
      panel.add(this.add.text(0, 238, String(row.score), { ...typography.number, fontSize: '32px' }).setOrigin(0.5))
      if (row.maxCombo !== undefined) panel.add(this.add.text(0, 280, 'MAX COMBO  ' + row.maxCombo, { ...typography.note, fontSize: '14px' }).setOrigin(0.5))
      this.screen?.add(panel)
    })
    if (vm.variant === 'RECORDS_5_PLUS') this.renderTop20(rows)
    this.addP0Start(1005, 70)
  }

  private addP0Start(y: number, height = 82): void {
    const start = new ActionButton(this, 'START', 420, height).setPosition(960, y)
    start.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.READY))
    this.screen?.add(start); this.register('p0', 'p0-start', start, () => this.appStateMachine.transitionTo(AppState.READY)); this.ui.focus.activate('p0')
  }

  private renderTop20(rows: ReadonlyArray<readonly [string, number]>): void {
    if (!rows.length) return
    const panel = new AngularPanel(this, 430, 760, uiTokens.colors.panelRaised).setPosition(1570, 570)
    panel.add(this.add.text(-174, -326, 'TOP 20', typography.secondaryAction).setOrigin(0, 0.5))
    rows.slice(0, 20).forEach(([name, score], index) => {
      const y = -278 + index * 30
      panel.add(this.add.rectangle(0, y + 15, 370, 1, uiTokens.colors.lineDim, 0.72))
      panel.add(this.add.text(-174, y, String(index + 1).padStart(2, '0') + '  ' + name, { ...typography.note, color: index === 0 ? colorHex('playerGlow') : colorHex('textPrimary'), fontSize: '17px' }).setOrigin(0, 0.5))
      panel.add(this.add.text(176, y, String(score), { ...typography.number, color: index === 0 ? colorHex('textPrimary') : colorHex('textSecondary'), fontSize: '18px' }).setOrigin(1, 0.5))
    })
    this.screen?.add(panel)
  }

  private renderP1(): void {
    const vm = characterSelectViewModel(this.selectedCharacterId)
    this.screen?.add(this.heading(vm.heading)); this.screen?.add(this.label('3 PRESETS  /  1 CUSTOM', 545, 166, 22, colorHex('systemBlue')))
    vm.choices.forEach((choice, index) => {
      const card = new CharacterCard(this, choice.label, choice.nickname, choice.custom, choice.spriteId && spriteTextureKey(choice.spriteId, 'idle')).setPosition(210 + index * 260, 505)
      // 選定後焦點移到 CONFIRM；否則鍵盤／手把往 CONFIRM 移動時會經過 CUSTOM 而改掉選擇。
      const pick = (): void => { this.selectCharacter(choice.id, true); this.ui.focus.activate('character', 'character-confirm') }
      card.setInteractive({ useHandCursor: true }).on('pointerup', pick)
      this.screen?.add(card); this.register('character', 'character-' + choice.id, card, pick)
      if (choice.id === vm.selectedId) card.setFocused(true)
    })
    addFocalGlow(this, this.screen as Phaser.GameObjects.Container, 1500, 520, 700, 740, uiTokens.colors.playerPrimary, uiTokens.glowAlpha.subtle)
    const hero = this.add.container(1500, 520); this.characterHero = hero
    const selected = vm.choices.find((choice) => choice.id === vm.selectedId)
    this.characterHeroTitle = this.add.text(0, -276, selected?.nickname ?? 'FIGHTER', { ...typography.secondaryAction, color: colorHex('playerGlow') }).setOrigin(0.5)
    hero.add(this.characterHeroTitle)
    this.characterHeroFallback = fighterSilhouette(this, 0, 50, 480, uiTokens.fighter.heroHeight, uiTokens.colors.playerPrimary, selected?.custom ? 0.24 : 0.42)
    hero.add(this.characterHeroFallback)
    this.characterPreview = this.addCharacterPreview(hero, selected?.spriteId, selected?.previewUrl, 0, 50, 500, uiTokens.fighter.heroHeight, this.characterHeroFallback)
    this.screen?.add(hero)
    const nickname = new AngularPanel(this, 940, 86, uiTokens.colors.panelRaised).setPosition(550, 875)
    this.characterNickname = this.add.text(-420, 0, 'NICKNAME  ' + vm.nickname, typography.nickname).setOrigin(0, 0.5)
    nickname.add(this.characterNickname); this.screen?.add(nickname)
    const confirm = new ActionButton(this, 'CONFIRM', 350, 80).setPosition(1510, 910)
    confirm.setInteractive({ useHandCursor: true }).on('pointerup', () => this.confirmCharacter())
    this.screen?.add(confirm); this.register('character', 'character-confirm', confirm, () => this.confirmCharacter())
    this.ui.focus.activate('character', 'character-' + vm.selectedId)
  }
  private updateCharacterPreview(id: string): void { const choice = characterChoices().find((item) => item.id === id); if (!choice || !this.characterHero || (id === this.selectedCharacterId && this.characterHeroFallback)) return; this.selectedCharacterId = id; this.characterHeroTitle?.setText(choice.nickname); this.characterNickname?.setText(`NICKNAME  ${choice.nickname}`); this.characterPreview?.destroy(); this.characterHeroFallback?.destroy(); this.characterHeroFallback = fighterSilhouette(this, 0, 50, 480, uiTokens.fighter.heroHeight, uiTokens.colors.playerPrimary, choice.custom ? 0.24 : 0.42); this.characterHero.add(this.characterHeroFallback); this.characterPreview = this.addCharacterPreview(this.characterHero, choice.spriteId, choice.previewUrl, 0, 50, 500, uiTokens.fighter.heroHeight, this.characterHeroFallback) }
  private selectCharacter(id: string, render = false): void { this.selectedCharacterId = id; this.persistence?.context.set({ selectedCharacterId: id }); if (render) this.render(AppState.READY) }
  private confirmCharacter(): void { this.selectCharacter(this.selectedCharacterId); void this.persistence?.updateSession(this.selectedCharacterId).catch(() => undefined); this.appStateMachine.transitionTo(AppState.SETUP) }

  private renderP2(): void {
    const vm = stageSelectViewModel(this.selectedStageId)
    this.screen?.add(this.heading(vm.heading))
    vm.stages.forEach((stage, index) => { const card = new StageCard(this, stage.label, stageTextureKey(stage.id)).setPosition(520 + index * 880, 520); card.setInteractive({ useHandCursor: true }).on('pointerup', () => this.selectStage(stage.id, true)); this.screen?.add(card); this.register('stage', `stage-${stage.id}`, card, () => this.selectStage(stage.id, true)); if (stage.id === vm.selectedStageId) card.setFocused(true) })
    const confirm = new ActionButton(this, 'CONFIRM', 380, 76).setPosition(960, 925); confirm.setInteractive({ useHandCursor: true }).on('pointerup', () => this.confirmStage()); this.screen?.add(confirm); this.register('stage', 'stage-confirm', confirm, () => this.confirmStage()); this.ui.focus.activate('stage', `stage-${vm.selectedStageId}`)
  }
  private selectStage(id: StageId, render = false): void { this.selectedStageId = id; this.persistence?.context.set({ selectedStageId: id }); if (render) this.render(AppState.SETUP) }
  private confirmStage(): void { this.selectStage(this.selectedStageId); this.appStateMachine.transitionTo(AppState.LOADING) }

  private renderP3(): void {
    const vm = loadingViewModel(this.selectedCharacterId, resolveStageAsset(this.selectedStageId).label, this.load.progress)
    const root = this.screen as Phaser.GameObjects.Container
    addFocalGlow(this, root, 460, 430, 650, 760, uiTokens.colors.playerPrimary, uiTokens.glowAlpha.player)
    addFocalGlow(this, root, 1460, 430, 620, 760, uiTokens.colors.enemyPrimary, uiTokens.glowAlpha.enemy)
    addFocalGlow(this, root, 960, 420, 520, 420, uiTokens.colors.systemBlue, uiTokens.glowAlpha.system)
    const energy = this.add.graphics()
    energy.lineStyle(uiTokens.glowWidth.energy, uiTokens.colors.playerGlow, 0.3).lineBetween(50, 710, 810, 120)
    energy.lineStyle(uiTokens.glowWidth.energy, uiTokens.colors.enemyGlow, 0.3).lineBetween(1870, 710, 1110, 120)
    energy.lineStyle(2, uiTokens.colors.systemBlue, 0.38).lineBetween(300, 720, 900, 130).lineBetween(1620, 720, 1020, 130)
    root.add(energy)
    this.screen?.add(this.label('PLAYER', 220, 126, 26, colorHex('playerGlow')))
    this.screen?.add(this.label(vm.character.nickname, 220, 170, 34, colorHex('textPrimary')))
    const playerFallback = fighterSilhouette(this, 430, 463, 500, 540, uiTokens.colors.playerPrimary, 0.42)
    root.add(playerFallback)
    this.addCharacterPreview(root, vm.character.spriteId, vm.character.previewUrl, 430, 500, 500, 700, playerFallback)
    const enemyFallback = fighterSilhouette(this, 1480, 452, 460, 590, uiTokens.colors.enemyPrimary, 0.42)
    root.add(enemyFallback)
    this.addCharacterPreview(root, this.enemySpriteId(), undefined, 1480, 500, 500, 700, enemyFallback)
    this.screen?.add(this.label('ENEMY', 1520, 126, 26, colorHex('enemyGlow')))
    this.screen?.add(this.label(vm.enemyName, 1520, 170, 34, colorHex('textPrimary')))
    const vs = this.add.text(960, 412, 'VS', { ...typography.title, fontSize: '170px', color: colorHex('textPrimary'), stroke: colorHex('systemBlue'), strokeThickness: uiTokens.textStroke.standard, shadow: { color: colorHex('systemBlue'), blur: uiTokens.shadowBlur.system, fill: true } }).setOrigin(0.5).setAlpha(0).setScale(0.82)
    this.screen?.add(vs)
    this.addScreenTween({ targets: vs, alpha: 1, scale: 1, duration: uiTokens.motionMs.focalReveal, ease: 'Cubic.Out' })
    this.screen?.add(this.label(vm.stage, 960, 690, 25, colorHex('textSecondary')))
    const controls = new AngularPanel(this, 1050, 340, uiTokens.colors.panelRaised).setPosition(550, 890)
    controls.add(this.add.text(-475, -133, 'CONTROLS', typography.secondaryAction).setOrigin(0, 0.5))
    vm.controls.forEach((control, index) => controls.add(this.add.text(-465 + (index % 2) * 470, -68 + Math.floor(index / 2) * 74, control, { ...typography.instruction, fontSize: '23px', color: colorHex('textPrimary') }).setOrigin(0, 0.5)))
    this.screen?.add(controls)
    const loading = new AngularPanel(this, 670, 340, uiTokens.colors.panelRaised).setPosition(1430, 890)
    loading.add(this.add.text(-286, -133, 'LOADING', typography.secondaryAction).setOrigin(0, 0.5))
    loading.add(this.add.text(-286, -66, vm.progress >= 1 ? 'ASSETS READY' : 'PREPARING', { ...typography.note, fontSize: '20px', color: colorHex('systemBlue') }).setOrigin(0, 0.5))
    loading.add(this.add.rectangle(0, 12, 530, 16, uiTokens.colors.background0, 0.96).setOrigin(0.5).setStrokeStyle(1, uiTokens.colors.lineBright))
    loading.add(this.add.rectangle(-265, 12, 522 * Math.max(0, Math.min(1, vm.progress)), 8, uiTokens.colors.systemBlue, 1).setOrigin(0, 0.5))
    loading.add(this.add.text(265, 72, Math.round(vm.progress * 100) + '%', { ...typography.number, fontSize: '24px', color: colorHex('textPrimary') }).setOrigin(1, 0.5))
    this.screen?.add(loading)
  }

  private renderP4(): void {
    this.battleRoot = this.add.container(0, 0)
    this.screen?.add(this.battleRoot)
    this.addArenaBackdrop(this.battleRoot, uiTokens.backdrop.battle)
    this.battleRoot.add(this.add.rectangle(960, 850, 1920, 460, uiTokens.colors.background0, 0.2))
    this.battlePlayer = new TemporarySpriteRenderer(this, this.playerSpriteId(), uiTokens.colors.playerPrimary, this.match.world.getConfig().floorY)
    this.battleEnemy = new TemporarySpriteRenderer(this, this.enemySpriteId(), uiTokens.colors.enemyPrimary, this.match.world.getConfig().floorY)
    this.battleRoot.add([this.battlePlayer, this.battleEnemy])
    this.battleRoot.add(new AngularPanel(this, 1740, 130, uiTokens.colors.background0, 0.82).setPosition(960, 80))
    this.battlePlayerBar = new HealthBar(this, 610, uiTokens.colors.playerPrimary).setPosition(180, 82)
    this.battleEnemyBar = new HealthBar(this, 610, uiTokens.colors.enemyPrimary, true).setPosition(1130, 82)
    this.battleRoot.add([this.battlePlayerBar, this.battleEnemyBar])
    this.battlePlayerRoundMarkers = [0, 1].map((index) => this.add.circle(238 + index * 22, 116, 5, uiTokens.colors.playerGlow, 0.24))
    this.battleEnemyRoundMarkers = [0, 1].map((index) => this.add.circle(1682 - index * 22, 116, 5, uiTokens.colors.enemyGlow, 0.24))
    this.battleRoot.add([...this.battlePlayerRoundMarkers, ...this.battleEnemyRoundMarkers])
    const playerPortrait = new AngularPanel(this, 72, 72, uiTokens.colors.panelRaised).setPosition(118, 82)
    playerPortrait.add(fighterSilhouette(this, 0, 0, 54, 58, uiTokens.colors.playerGlow, 0.68))
    const enemyPortrait = new AngularPanel(this, 72, 72, uiTokens.colors.panelRaised).setPosition(1802, 82)
    enemyPortrait.add(fighterSilhouette(this, 0, 0, 54, 58, uiTokens.colors.enemyGlow, 0.68))
    this.battleRoot.add([playerPortrait, enemyPortrait])
    this.battleRoot.add(this.label('ROG_Player', 230, 34, 26, colorHex('textPrimary')))
    this.battleRoot.add(this.label('ROG_SAGA', 1690, 34, 26, colorHex('textPrimary')))
    addFocalGlow(this, this.battleRoot, 960, 80, 280, 110, uiTokens.colors.enemyPrimary, uiTokens.glowAlpha.enemy)
    this.battleTimer = this.add.text(960, 76, '60', { ...typography.timer, fontSize: '72px', color: colorHex('textPrimary'), stroke: colorHex('enemyPrimary'), strokeThickness: uiTokens.textStroke.timer }).setOrigin(0.5)
    this.battleRoot.add(this.battleTimer)
    this.battleRoot.add(this.label('ROUND  /  PLAYER - ENEMY', 960, 130, 16, colorHex('textSecondary')))
    this.battleInfo = this.add.text(960, 153, '', { ...typography.note, fontSize: '18px', color: colorHex('textPrimary') }).setOrigin(0.5)
    this.battleRoot.add(this.battleInfo)
    this.battleCombo = this.add.text(280, 350, '', typography.combo).setOrigin(0.5)
    this.battleRoot.add(this.battleCombo)
    this.battleDanger = this.add.text(1640, 350, '', typography.danger).setOrigin(0.5)
    this.battleRoot.add(this.battleDanger)
    this.battleFirstAttack = this.add.text(960, 315, 'FIRST ATTACK!', { ...typography.note, color: colorHex('statusLime'), fontStyle: 'bold' }).setOrigin(0.5).setVisible(false)
    this.battleRoot.add(this.battleFirstAttack)
    this.battleAnnouncer = new AnnouncerText(this)
    this.battleAnnouncer.setPosition(960, 410)
    this.battleRoot.add(this.battleAnnouncer)
  }
  private updateBattle(snapshot: MatchSnapshot): void { if (!this.battleRoot || !this.battlePlayer || !this.battleEnemy || !this.battleTimer || !this.battleInfo || !this.battlePlayerBar || !this.battleEnemyBar) return; const sourceVm = battleViewModel(snapshot, this.selectedStageId); const vm = this.showcaseState === AppState.BATTLE && this.showcaseBattleVariant !== 'NORMAL' ? { ...sourceVm, combo: this.showcaseBattleVariant === 'COMBO' ? 4 : sourceVm.combo, danger: this.showcaseBattleVariant === 'DANGER' || sourceVm.danger, lastTenSeconds: this.showcaseBattleVariant === 'LAST_10_SECONDS' || sourceVm.lastTenSeconds, timerSeconds: this.showcaseBattleVariant === 'LAST_10_SECONDS' ? 10 : sourceVm.timerSeconds } : sourceVm; const tick = snapshot.world.tick; const events = this.tickEvents.splice(0); const hit = events.find((e) => e.type === 'HIT'); if (hit?.type === 'HIT' && this.firstHit?.round !== vm.round) this.firstHit = { round: vm.round, tick, byPlayer: hit.attacker === 'PLAYER' }
    // ponytail: reaction hold is four 24Hz ticks; retune if tick rate or blockstun timing changes
    const held = (from: number, ticks: number): boolean => tick >= from && tick < from + ticks
    this.battlePlayer.update(vm.player, tick); this.battleEnemy.update(vm.enemy, tick); this.battlePlayerBar.setRatio(vm.playerHp / vm.maxHp); this.battleEnemyBar.setRatio(vm.enemyHp / vm.maxHp); this.battlePlayerRoundMarkers.forEach((marker, index) => marker.setAlpha(index < vm.playerWins ? 1 : 0.24)); this.battleEnemyRoundMarkers.forEach((marker, index) => marker.setAlpha(index < vm.enemyWins ? 1 : 0.24)); this.battleTimer.setText(String(vm.timerSeconds).padStart(2, '0')); this.battleInfo.setText(`R${vm.round}   ${vm.playerWins} — ${vm.enemyWins}`); this.battleCombo?.setText(vm.combo >= 2 ? `${vm.combo} HIT COMBO` : '').setVisible(vm.combo >= 2); this.battleDanger?.setText(vm.danger ? 'DANGER' : '').setVisible(vm.danger); this.battleFirstAttack?.setVisible(Boolean(this.firstHit?.byPlayer && this.firstHit.round === vm.round && held(this.firstHit.tick, 24))); const showcaseMessage = this.showcaseAnnouncer ? 'FIGHT!' : ''; const message = vm.lastTenSeconds ? '10 SECONDS!' : vm.danger ? 'DANGER!' : vm.combo >= 2 ? 'NICE COMBO!' : (snapshot.world.tick === 0 && !this.showcaseState ? 'FIGHT!' : showcaseMessage); this.battleAnnouncer?.showMessage(message) }

  private renderP5(): void {
    const vm = presentationViewModel(this.resolvedResult, this.showcaseState === AppState.PRESENTATION ? this.showcaseP5Variant : undefined)
    this.battleRoot = this.add.container(0, 0); this.screen?.add(this.battleRoot); this.addArenaBackdrop(this.battleRoot, uiTokens.backdrop.presentation)
    const snapshot = this.match.getSnapshot()
    this.battlePlayer = new TemporarySpriteRenderer(this, this.playerSpriteId(), uiTokens.colors.playerPrimary, this.match.world.getConfig().floorY)
    this.battlePlayer.update(snapshot.world.fighters.PLAYER, snapshot.world.tick)
    this.battleEnemy = new TemporarySpriteRenderer(this, this.enemySpriteId(), uiTokens.colors.enemyPrimary, this.match.world.getConfig().floorY)
    this.battleEnemy.update(snapshot.world.fighters.ENEMY, snapshot.world.tick)
    this.battleRoot.add([this.battlePlayer, this.battleEnemy])
    this.battleRoot.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.backdrop.impact))
    addFocalGlow(this, this.battleRoot, 960, 470, 1120, 450, uiTokens.colors.danger, uiTokens.glowAlpha.result)
    addFocalGlow(this, this.battleRoot, 960, 470, 760, 310, uiTokens.colors.resultGold, uiTokens.glowAlpha.gold)
    const impact = this.add.graphics()
    impact.lineStyle(20, uiTokens.colors.danger, 0.46).lineBetween(465, 610, 1455, 315)
    impact.lineStyle(6, uiTokens.colors.resultGold, 0.62).lineBetween(520, 635, 1405, 370)
    impact.lineStyle(3, uiTokens.colors.playerGlow, 0.38).lineBetween(580, 660, 1320, 410)
    this.battleRoot.add(impact)
    if (vm.headline) {
      const ko = this.add.text(960, 438, vm.headline, { ...typography.announcer, fontSize: '190px', color: colorHex('resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.impact, shadow: { color: colorHex('danger'), blur: uiTokens.shadowBlur.impact, fill: true } }).setOrigin(0.5).setRotation(-0.045).setScale(0.86).setAlpha(0)
      if (this.game.renderer.type === Phaser.WEBGL) ko.postFX.addGradient(uiTokens.colors.resultGold, uiTokens.colors.danger, 0.72, 0, 0, 0, 1)
      this.screen?.add(ko)
      this.addScreenTween({ targets: ko, scale: 1, alpha: 1, duration: uiTokens.motionMs.announcer, ease: 'Back.Out' })
    }
    if (vm.outcome) {
      const semantic = vm.result === 'WIN' ? colorHex('playerGlow') : vm.result === 'DRAW' ? colorHex('systemBlue') : colorHex('textSecondary')
      this.screen?.add(this.add.text(960, 642, vm.outcome, { ...typography.action, fontSize: '48px', color: semantic, shadow: vm.result === 'WIN' ? { color: colorHex('danger'), blur: uiTokens.shadowBlur.semantic, fill: true } : undefined }).setOrigin(0.5))
    }
    if (this.resolvedResult && !this.showcaseState) {
      const next = new ActionButton(this, 'VIEW RESULTS', 380, 76).setPosition(960, 870)
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
    const columns = [{ x: 340, w: 520, title: 'STATISTICS' }, { x: 940, w: 620, title: 'RESULT' }, { x: 1560, w: 560, title: 'RANKING' }]
    const panels = columns.map(({ x, w, title }) => {
      const panel = new AngularPanel(this, w, 760, uiTokens.colors.panelRaised).setPosition(x, 570)
      panel.add(this.add.text(-w / 2 + 28, -328, title, typography.secondaryAction).setOrigin(0, 0.5))
      panel.add(this.add.rectangle(0, -292, w - 52, 1, uiTokens.colors.lineDim, 0.9))
      this.screen?.add(panel)
      return panel
    })
    const [statistics, result, ranking] = panels
    const statStep = Math.min(88, 480 / Math.max(1, vm.statistics.length))
    vm.statistics.forEach((stat, index) => {
      const y = -220 + index * statStep
      statistics.add(this.add.text(-215, y, stat.label, { ...typography.note, fontSize: '18px', color: colorHex('textSecondary') }).setOrigin(0, 0.5))
      statistics.add(this.add.text(215, y, String(stat.value), { ...typography.number, fontSize: '26px' }).setOrigin(1, 0.5))
      statistics.add(this.add.rectangle(0, y + statStep / 2, 450, 1, uiTokens.colors.lineDim, 0.65))
    })
    const win = vm.outcome === 'WIN'
    const headlineColor = win ? colorHex('playerGlow') : vm.outcome === 'DRAW' ? colorHex('systemBlue') : colorHex('textSecondary')
    addFocalGlow(this, result, 0, -150, 520, 260, win ? uiTokens.colors.playerPrimary : uiTokens.colors.systemBlue, win ? uiTokens.glowAlpha.win : uiTokens.glowAlpha.subtle)
    const headline = this.add.text(0, -170, vm.headline, { ...typography.announcer, fontSize: '76px', color: headlineColor, stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.result, shadow: win ? { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.focal, fill: true } : undefined }).setOrigin(0.5).setScale(0.88).setAlpha(0)
    result.add(headline)
    this.addScreenTween({ targets: headline, scale: 1, alpha: 1, duration: uiTokens.motionMs.focalReveal, ease: 'Cubic.Out' })
    const title = this.add.text(0, -38, vm.title, { ...typography.secondaryAction, fontSize: '34px', color: colorHex('resultGold') }).setOrigin(0.5).setAlpha(0)
    const scoreLabel = this.add.text(0, 68, 'SCORE', { ...typography.note, fontSize: '18px', color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    const score = this.add.text(0, 120, String(vm.score), { ...typography.number, fontSize: '66px' }).setOrigin(0.5).setAlpha(0)
    const rank = this.add.text(0, 207, 'RANK  ' + (vm.rank ?? 'NOT RANKED'), { ...typography.note, fontSize: '22px', color: colorHex('textSecondary') }).setOrigin(0.5).setAlpha(0)
    result.add([title, scoreLabel, score, rank])
    this.addScreenTween({ targets: [title, scoreLabel, score, rank], alpha: 1, duration: 160, delay: 100, ease: 'Cubic.Out' })
    if (vm.newRecord) {
      const badge = this.add.text(0, 278, 'NEW RECORD', { ...typography.secondaryAction, fontSize: '29px', color: colorHex('resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.badge, shadow: { color: colorHex('playerPrimary'), blur: uiTokens.shadowBlur.subtle, fill: true } }).setOrigin(0.5).setAlpha(0)
      result.add(badge)
      this.addScreenTween({ targets: badge, alpha: 1, duration: 160, delay: 240, ease: 'Cubic.Out' })
    }
    vm.ranking.forEach((row, index) => {
      const y = -246 + index * 46
      if (row.highlighted) ranking.add(this.add.rectangle(0, y, 460, 40, uiTokens.colors.playerPrimary, 0.24))
      ranking.add(this.add.rectangle(0, y + 23, 462, 1, uiTokens.colors.lineDim, 0.66))
      if (row.highlighted) ranking.add(this.add.rectangle(-227, y, 4, 40, uiTokens.colors.playerGlow, 0.95))
      ranking.add(this.add.text(-210, y, String(row.rank).padStart(2, '0') + '  ' + row.name, { ...typography.note, fontSize: '18px', color: colorHex('textPrimary') }).setOrigin(0, 0.5))
      ranking.add(this.add.text(210, y, String(row.score), { ...typography.number, fontSize: '20px', color: row.highlighted ? colorHex('textPrimary') : colorHex('textSecondary') }).setOrigin(1, 0.5))
    })
    if (this.resolvedResult && !this.showcaseState) {
      const next = new ActionButton(this, 'CONTINUE', 380, 72).setPosition(960, 1010)
      next.setInteractive({ useHandCursor: true }).on('pointerup', () => this.appStateMachine.transitionTo(AppState.END))
      this.screen?.add(next); this.register('result', 'result-next', next, () => this.appStateMachine.transitionTo(AppState.END)); this.ui.focus.activate('result')
    }
  }

  private renderP7(): void {
    const vm = endViewModel(this.nextPlayerName)
    addFocalGlow(this, this.screen as Phaser.GameObjects.Container, 960, 515, 900, 560, uiTokens.colors.systemBlue, uiTokens.glowAlpha.ambient)
    const panel = new AngularPanel(this, 760, 540, uiTokens.colors.panelRaised).setPosition(960, 525)
    panel.add(this.add.text(0, -185, 'ONE MORE ROUND?', { ...typography.title, fontSize: '58px' }).setOrigin(0.5))
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
      next.add(this.add.text(-180, -63, 'NEXT', { ...typography.secondaryAction, fontSize: '22px', color: colorHex('systemBlue') }).setOrigin(0, 0.5))
      next.add(fighterSilhouette(this, -125, 35, 116, 128, uiTokens.colors.enemyPrimary, 0.42))
      next.add(this.add.text(-60, 34, vm.nextPlayerName, { ...typography.secondaryAction, fontSize: '26px' }).setOrigin(0, 0.5))
      this.screen?.add(next)
    }
  }
  private installShowcaseKeys(): void {
    const bind = (event: string, listener: () => void): void => { this.input.keyboard?.on(event, listener); this.showcaseListeners.push({ event, listener }) }
    bind('keydown-ONE', () => { this.showcaseP0Variant = 'EMPTY'; this.showcase('P0') })
    bind('keydown-TWO', () => this.showcase('P1')); bind('keydown-THREE', () => this.showcase('P2')); bind('keydown-FOUR', () => this.showcase('P3')); bind('keydown-FIVE', () => this.showcase('P4'))
    bind('keydown-SIX', () => { this.showcaseP5Variant = 'KO'; this.showcase('P5') }); bind('keydown-SEVEN', () => this.showcase('P6')); bind('keydown-EIGHT', () => this.showcase('P7'))
    bind('keydown-ZERO', () => { this.showcaseP0Variant = this.showcaseP0Variant === 'EMPTY' ? 'RECORDS_1_TO_4' : this.showcaseP0Variant === 'RECORDS_1_TO_4' ? 'RECORDS_5_PLUS' : 'EMPTY'; this.showcaseState = AppState.IDLE; this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-N', () => { this.showcaseBattleVariant = 'NORMAL'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-C', () => { if (this.showcaseState === AppState.BATTLE) this.showcaseBattleVariant = 'COMBO'; else if (this.showcaseState === AppState.READY) { const choices = characterChoices(); const index = choices.findIndex((choice) => choice.id === this.selectedCharacterId); this.selectedCharacterId = choices[(index + 1) % choices.length].id; this.render(this.appStateMachine.getCurrentState()) }; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-D', () => { this.showcaseBattleVariant = 'DANGER'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-T', () => { this.showcaseBattleVariant = 'LAST_10_SECONDS'; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-UP', () => { if (this.showcaseLab) { const length = existingAnimationEntries().length; this.labIndex = (this.labIndex - 1 + length) % length; this.render(this.appStateMachine.getCurrentState()) } })
    bind('keydown-DOWN', () => { if (this.showcaseLab) { this.labIndex = (this.labIndex + 1) % existingAnimationEntries().length; this.render(this.appStateMachine.getCurrentState()) } })
    bind('keydown-V', () => { this.showcaseLab = !this.showcaseLab; this.showcaseState = undefined; this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-B', () => { this.selectedStageId = this.selectedStageId === 'laboratory' ? 'company-building' : 'laboratory'; if (this.showcaseLab || this.showcaseState === AppState.SETUP || this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-F', () => { this.labFacing = this.labFacing === 'RIGHT' ? 'LEFT' : 'RIGHT'; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-H', () => { this.labHud = !this.labHud; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-L', () => { this.labLoop = !this.labLoop; if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-A', () => { this.showcaseAnnouncer = !this.showcaseAnnouncer; if (this.showcaseState === AppState.BATTLE) this.render(this.appStateMachine.getCurrentState()) })
    bind('keydown-R', () => { if (this.showcaseLab) this.render(this.appStateMachine.getCurrentState()) })
  }

  private installShowcaseP5Keys(): void {
    const show = (variant: P5ShowcaseVariant): void => { this.showcaseP5Variant = variant; this.showcase('P5') }
    const bind = (event: string, listener: () => void): void => { this.input.keyboard?.on(event, listener); this.showcaseListeners.push({ event, listener }) }
    bind('keydown-M', () => show('TIME_UP')); bind('keydown-Y', () => show('WIN'))
  }

  private installShowcaseRankKeys(): void {
    const show = (substate: P6SubState): void => { this.showcaseP6SubState = substate; this.showcase('P6') }
    const bind = (event: string, listener: () => void): void => { this.input.keyboard?.on(event, listener); this.showcaseListeners.push({ event, listener }) }
    bind('keydown-R', () => { if (!this.showcaseLab) show('RANK_1_TO_6') }); bind('keydown-I', () => show('RANK_7_TO_19')); bind('keydown-K', () => show('RANK_20')); bind('keydown-U', () => show('NOT_RANKED'))
  }

  private showcase(state: string): void {
    if (!import.meta.env.DEV || !this.showcaseEnabled) return
    this.showcaseState = ({ P0: AppState.IDLE, P1: AppState.READY, P2: AppState.SETUP, P3: AppState.LOADING, P4: AppState.BATTLE, P5: AppState.PRESENTATION, P6: AppState.RESULT, P7: AppState.END } as Record<string, AppStateValue>)[state]
    if (this.showcaseState === AppState.BATTLE) this.showcaseBattleVariant = 'NORMAL'
    this.render(this.appStateMachine.getCurrentState())
  }

  private renderAnimationLab(): void {
    const cover = aspectCover(2752, 1536, 1920, 1080)
    this.screen?.add(this.add.image(cover.x + cover.width / 2, cover.y + cover.height / 2, stageTextureKey(this.selectedStageId)).setDisplaySize(cover.width, cover.height))
    this.screen?.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, 0.56))
    this.screen?.add(this.heading('CHARACTER ANIMATION LAB'))
    this.screen?.add(this.label('V preview  /  B stage  /  F facing  /  H HUD  /  L loop  /  R replay', 960, 165, 24, colorHex('systemBlue')))
    const entries = existingAnimationEntries(); const entry = entries[this.labIndex % entries.length]; const validation = sampleWebmValidation.find((item) => item.filename === entry.filename)
    const list = new AngularPanel(this, 420, 760, uiTokens.colors.panelRaised).setPosition(270, 580); let y = -340
    animationCategories.forEach((category) => { list.add(this.add.text(-180, y, category.label, { ...typography.note, fontSize: '19px', color: colorHex('systemBlue'), fontStyle: 'bold' }).setOrigin(0, 0.5)); y += 25; category.keys.forEach((key) => { const item = sampleCharacterAnimationManifest[key]; if (!item.url) return; list.add(this.add.text(-165, y, (item.previewOnly ? 'PREVIEW ' : 'RUNTIME ') + item.key, { ...typography.note, fontSize: '16px', color: item.key === entry.key ? colorHex('playerGlow') : colorHex('textPrimary') }).setOrigin(0, 0.5)); y += 23 }); y += 8 })
    this.screen?.add(list)
    const diagnostics = new AngularPanel(this, 500, 560, uiTokens.colors.panelRaised).setPosition(1590, 590)
    diagnostics.add(this.add.text(-220, -225, 'DIAGNOSTICS', typography.secondaryAction).setOrigin(0, 0.5))
    diagnostics.add(this.add.text(-220, -165, 'KEY ' + entry.key + '\nFILE ' + entry.filename + '\nDURATION ' + (validation?.durationMs ?? entry.nominalDurationMs ?? 'unknown') + 'ms\nDIMENSIONS ' + (validation ? validation.width + ' x ' + validation.height : 'runtime probe') + '\nLOOP ' + this.labLoop + '\nPREVIEW ONLY ' + entry.previewOnly + '\nFACING ' + this.labFacing + '\nSTAGE ' + resolveStageAsset(this.selectedStageId).label + '\nPLAYBACK RATE natural', { ...typography.note, fontSize: '19px', lineSpacing: 7 }))
    const mediaStatus = this.add.text(-220, 175, 'MEDIA PLACEHOLDER', { ...typography.note, fontSize: '20px', color: colorHex('systemBlue') })
    diagnostics.add(mediaStatus); this.screen?.add(diagnostics)
    this.labRenderer = new FighterVideoRenderer(this, sampleCharacterAnimationManifest, uiTokens.colors.playerPrimary, (status) => mediaStatus.setText('MEDIA ' + status))
    this.labRenderer.setPosition(960, 850); this.labRenderer.preview(entry.key, this.labFacing, this.labLoop); this.screen?.add(this.labRenderer)
    if (this.labHud) {
      const hud = this.add.container(0, 0); hud.add(this.add.rectangle(960, 105, 1740, 142, uiTokens.colors.background0, 0.82).setStrokeStyle(2, uiTokens.colors.lineBright))
      const playerBar = new HealthBar(this, 610, uiTokens.colors.playerPrimary).setPosition(180, 130); const enemyBar = new HealthBar(this, 610, uiTokens.colors.enemyPrimary, true).setPosition(1130, 130)
      hud.add([playerBar, enemyBar]); hud.add(this.add.text(960, 155, '60', typography.timer).setOrigin(0.5)); hud.add(this.label('ROG_Player', 230, 90, 34, colorHex('textPrimary'))); hud.add(this.label('ROG_SAGA', 1690, 90, 34, colorHex('textPrimary'))); this.screen?.add(hud)
    }
  }

  private renderOverlay(): void {
    const overlay = this.add.container(0, 0)
    overlay.add(this.add.rectangle(960, 540, 1920, 1080, uiTokens.colors.background0, uiTokens.opacity.overlay))
    const confirmMode = this.ui.navigation.isExitConfirmationOpen()
    const panel = new AngularPanel(this, 650, confirmMode ? 440 : 520, uiTokens.colors.panelRaised).setPosition(960, 540)
    panel.add(this.add.text(0, confirmMode ? -148 : -176, confirmMode ? 'EXIT GAME?' : 'PAUSED', typography.title).setOrigin(0.5))
    panel.add(this.add.rectangle(0, confirmMode ? -92 : -120, 560, 1, uiTokens.colors.lineDim, 0.9))
    const actions = confirmMode ? ['CANCEL', 'CONFIRM'] : ['CONTINUE', 'RESTART', 'EXIT']
    actions.forEach((action, index) => {
      const buttonColor = action === 'CONTINUE' || action === 'CONFIRM' ? uiTokens.colors.playerPrimary : uiTokens.colors.panel
      const button = new ActionButton(this, action, 380, 66, buttonColor).setPosition(0, (confirmMode ? -15 : -36) + index * 88)
      if (action === 'RESTART') button.setEnabled(false)
      button.setInteractive({ useHandCursor: true }).on('pointerup', () => this.overlayAction(action))
      panel.add(button)
      this.register(confirmMode ? 'overlay-confirm' : 'overlay', 'overlay-' + action, button, () => this.overlayAction(action), action !== 'RESTART')
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

  private playerSpriteId(): SpriteId | undefined { return characterChoices().find((choice) => choice.id === this.selectedCharacterId)?.spriteId }
  private enemySpriteId(): SpriteId { return this.playerSpriteId() === 'riven' ? 'kael' : 'riven' }

  private addCharacterPreview(parent: Phaser.GameObjects.Container, spriteId: SpriteId | undefined, videoUrl: string | undefined, x: number, y: number, width: number, height: number, fallback: Phaser.GameObjects.Graphics): Phaser.GameObjects.Image | Phaser.GameObjects.Video | undefined {
    const key = spriteId && spriteTextureKey(spriteId, 'idle')
    if (key && this.textures.exists(key)) {
      const size = Math.min(height, width * 1.3)
      const image = this.add.image(x, y, key).setDisplaySize(size, size)
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
    stopOwnedTweens(this.screenTweens)
    this.ui.focus.clearGroup('p0'); this.ui.focus.clearGroup('character'); this.ui.focus.clearGroup('stage'); this.ui.focus.clearGroup('presentation'); this.ui.focus.clearGroup('result'); this.ui.focus.clearGroup('end'); this.ui.focus.clearGroup('dev'); this.ui.focus.clearGroup('overlay'); this.ui.focus.clearGroup('overlay-confirm')
    this.buttons.clear(); this.battlePlayer?.destroy(); this.labRenderer?.destroy()
    this.battlePlayer = undefined; this.battleEnemy = undefined; this.labRenderer = undefined; this.battleRoot = undefined; this.battlePlayerRoundMarkers = []; this.battleEnemyRoundMarkers = []; this.characterHero = undefined; this.characterHeroTitle = undefined; this.characterPreview = undefined; this.characterHeroFallback = undefined; this.characterNickname = undefined
    this.screen?.destroy(true); this.screen = undefined
  }
  private destroyScene(): void { this.destroyScreen(); this.showcaseListeners.forEach(({ event, listener }) => this.input.keyboard?.off(event, listener)); this.combatUnsubscribe?.(); this.unsubscribe?.(); this.clockUnsubscribe?.(); this.uiUnsubscribers.forEach((unsubscribe) => unsubscribe()); this.inputManager.detachKeyboard(); this.clock.stop() }
}
