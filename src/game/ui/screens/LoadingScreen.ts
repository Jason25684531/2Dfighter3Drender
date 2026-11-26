import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import type { InputManager, PlayerSlotId } from '../../input/InputManager'
import type { CombatAction } from '../../input/ControlProfile'
import { padLabel, type PadProfiles } from '../../input/GamepadProfile'
import { faceKey, type GenerationJobs } from '../../app/GenerationJobs'
import { intentFromInput, type CombatEvent } from '../../combat/CombatWorld'
import { MatchController, ROUND_TICKS } from '../../match/MatchController'
import { practiceTick } from '../../match/practice'
import { FIXED_STEP_MS, type GameClock } from '../../time/GameClock'
import type { PresentationContext, SpriteId } from '../animation/TemporarySpriteManifest'
import { BattleView } from '../battle/BattleView'
import { ActionButton, AngularPanel, KeyCap } from '../VisualComponents'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { LOADING_TITLE, loadingStatus } from '../ViewModels'
import { resolveStageAsset } from '../assets/TestAssetManifest'
import { alignedAnimations, alignedSprites } from '../animation/SheetSpriteManifest'
import { ArenaScreen, type Matchup, type ScreenContext } from './ScreenView'

export type LoadingOptions = { matchup: Matchup; pads: PadProfiles; input: InputManager; clock: GameClock; jobs: GenerationJobs; retry: () => boolean }

/** P3 練習場：生成與素材載入期間可自由練習（獨立的練習對戰，不計分）；都完成後 FIGHT! 才可按，失敗時同一顆按鈕變成重試。 */
export class LoadingScreen extends ArenaScreen {
  ready?: boolean
  private readonly practice = new MatchController()
  private readonly view: BattleView
  private readonly events: CombatEvent[] = []
  private readonly unsubscribe: () => void
  private readonly playerContext: PresentationContext = {}
  private readonly enemyContext: PresentationContext = {}
  private readonly button: ActionButton
  private readonly skipButton: ActionButton
  private readonly title: Phaser.GameObjects.Text
  private readonly bar: Phaser.GameObjects.Rectangle
  private readonly percent: Phaser.GameObjects.Text
  private face?: Phaser.GameObjects.Image
  private pulse?: Phaser.Tweens.Tween

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, private readonly options: LoadingOptions) {
    super(ctx, root, options.matchup.stageId, uiTokens.backdrop.battle)
    const { scene } = this, { colors } = uiTokens, { matchup, pads } = options
    const config = this.practice.world.getConfig()
    this.unsubscribe = this.practice.world.subscribe((event) => { this.events.push(event) })
    this.practice.start()
    this.view = new BattleView(scene, this.arena, this.stage.world, { stage: matchup.stageId, playerSprite: matchup.playerSprite, enemySprite: matchup.enemySprite, playerName: matchup.playerName, enemyName: matchup.enemyName, twoPlayer: matchup.twoPlayer, floorY: config.floorY, maxHp: config.maxHp, input: options.input, audio: ctx.audio, combat: this.practice.world })
    this.view.update(this.practice.getSnapshot(), [], this.playerContext, undefined, this.enemyContext)

    const padKey = (...actions: CombatAction[]): string => actions.map((action) => padLabel(pads.P1[action])).join(' ')
    const panel = new AngularPanel(scene, 1040, 150, colors.panelRaised).setPosition(560, 985)
    panel.add(scene.add.text(-490, -50, `PRACTICE ・ 練習場  ·  ${resolveStageAsset(matchup.stageId).label}  ·  ${padKey('CROUCH')} 蹲 · 後退＝防禦`, { ...typography.note, color: colorHex('statusLime') }).setOrigin(0, 0.5))
    const bindings = [['MOVE', padKey('MOVE_LEFT', 'MOVE_RIGHT')], ['JUMP', padKey('JUMP')], ['PUNCH', padKey('LIGHT_PUNCH', 'HEAVY_PUNCH')], ['KICK', padKey('LIGHT_KICK', 'HEAVY_KICK')]]
    bindings.forEach(([action, pad], i) => {
      const x = -490 + i * 255
      panel.add([scene.add.text(x, 20, action, typography.note).setOrigin(0, 0.5), new KeyCap(scene, pad).setPosition(x + 150, 20)])
    })
    root.add(panel)

    const loading = new AngularPanel(scene, 680, 150, colors.panelRaised).setPosition(1540, 985)
    this.title = scene.add.text(-315, -45, LOADING_TITLE.LOADING.text, typography.note).setOrigin(0, 0.5)
    this.bar = scene.add.rectangle(-315, 15, 300, 12, colors.systemBlue).setOrigin(0, 0.5)
    this.percent = scene.add.text(-315, 45, '', typography.note).setOrigin(0, 0.5)
    this.button = new ActionButton(scene, 'FIGHT!', 300, 92, colors.playerPrimary, `${padLabel(pads.P1.LIGHT_KICK)} / START`).setPosition(165, 0).setEnabled(false)
    const fight = (): void => { if (!options.retry() && this.ready) ctx.go(AppState.BATTLE) }
    this.button.on('pointerup', fight)
    this.skipButton = new ActionButton(scene, '略過生成', 172, 44, colors.panel).setPosition(-110, 44).setEnabled(false).setVisible(false)
    this.skipButton.label.setFontFamily(uiTokens.fonts.zh).setFontSize(22)
    const skip = (): void => { if (options.jobs.skipFailed()) ctx.go(AppState.BATTLE) }
    this.skipButton.on('pointerup', skip)
    loading.add([this.title, scene.add.rectangle(-315, 15, 300, 12, colors.background0).setOrigin(0, 0.5), this.bar, this.percent, this.button, this.skipButton]); root.add(loading)
    this.focusable('loading', 'loading-fight', this.button, fight, false)
    this.focusable('loading', 'loading-skip-generation', this.skipButton, skip, false)
    this.refresh()
  }

  tick(): void {
    const { input, matchup } = this.options, p1 = input.consumeGameplaySnapshot(), p2 = input.consumeGameplaySnapshot('P2')
    this.playerContext.crouch = p1.crouchHeld; this.enemyContext.crouch = matchup.twoPlayer && p2.crouchHeld
    practiceTick(this.practice, intentFromInput(p1), matchup.twoPlayer ? intentFromInput(p2) : undefined)
    // 練習不限時：HUD 計時固定在整回合，不顯示倒數。
    this.view.update({ ...this.practice.getSnapshot(), remainingTicks: ROUND_TICKS }, this.events.splice(0), this.playerContext, this.practice.getRoundSummaries().at(-1), this.enemyContext)
  }

  update(deltaMs: number): void {
    this.view.renderAt(Math.min(1, Math.max(0, this.options.clock.getRemainderMs() / FIXED_STEP_MS)))
    this.stage.follow(this.view.player.x, this.view.enemy.x, reducedMotion ? Infinity : deltaMs / 1000)
    this.refresh()
  }

  destroy(): void { this.unsubscribe(); this.view.destroy(); super.destroy() }

  useGeneratedSprite(owner: PlayerSlotId, sprite: SpriteId): void { this.view.setSprite(owner === 'P1' ? 'PLAYER' : 'ENEMY', sprite) }
  get canSkipGeneration(): boolean { return this.options.jobs.canSkip }

  /** 本場兩位角色的原圖圖集已上傳幾成；圖集用 fetch 載入、不經 Phaser loader，所以直接數貼圖。 */
  private assetProgress(): number {
    const { playerSprite, enemySprite } = this.options.matchup
    const keys = [playerSprite, enemySprite].flatMap((sprite) => sprite ? alignedAnimations.map(({ key }) => `${sprite in alignedSprites ? `hd-${sprite}` : sprite}-${key}`) : [])
    return keys.length ? keys.filter((key) => this.scene.textures.exists(key)).length / keys.length : 1
  }

  private refresh(): void {
    const { scene, options: { jobs } } = this
    // 生成中在狀態列左側顯示還在生成那位的拍攝頭像：1P 完成後換成 2P；都完成就停在最後一位。
    const owner = jobs.generatingOwner, key = owner && faceKey(owner)
    if (key && scene.textures.exists(key) && this.face?.texture.key !== key) {
      if (this.face) this.face.setTexture(key).setDisplaySize(80, 80)
      else { this.face = scene.add.image(1130, 985, key).setDisplaySize(80, 80); this.root.add(this.face) }
    }
    const generationFailed = jobs.failed, assetFailed = jobs.assets === 'failed', generating = jobs.generating
    const busy = generating || jobs.assets === 'idle' || jobs.assets === 'loading'
    const progress = busy ? this.assetProgress() : 1
    this.bar.setScale(generating ? 0.5 : progress, 1)
    this.percent.setText(generationFailed ? '生成失敗' : assetFailed ? '載入失敗 · 可重試' : generating ? '角色生成中 · 先練習' : busy ? Math.round(progress * 100) + '%' : 'READY · 可開戰')
    this.button.label.setText(generationFailed || assetFailed ? 'RETRY · 重試' : 'FIGHT!')
    const status = LOADING_TITLE[loadingStatus({ busy, generating, failed: generationFailed || assetFailed })]
    this.title.setText(status.text).setColor(colorHex(status.color))
    const ready = !busy && !generationFailed && !assetFailed
    const canSkip = this.canSkipGeneration && !busy
    if (this.skipButton.visible !== canSkip) {
      this.skipButton.setVisible(canSkip).setEnabled(canSkip)
      this.ctx.ui.focus.setEnabled('loading', 'loading-skip-generation', canSkip)
    }
    // 失敗時按鈕仍可按（＝重試），只有忙碌中停用。
    if (this.ready !== ready || this.button.input?.enabled !== !busy) {
      this.ready = ready; this.button.setEnabled(!busy); this.ctx.ui.focus.setEnabled('loading', 'loading-fight', !busy)
      this.pulse?.stop(); this.button.label.setAlpha(1)
      if (!busy) { this.ctx.ui.focus.activate('loading', 'loading-fight'); this.pulse = this.tween({ targets: this.button.label, alpha: 0.7, duration: 700, yoyo: true, repeat: -1 }) }
    }
  }
}
