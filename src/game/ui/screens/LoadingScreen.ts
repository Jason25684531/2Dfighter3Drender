import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import type { InputManager } from '../../input/InputManager'
import { keyLabel, type CombatAction, type ControlProfiles } from '../../input/ControlProfile'
import { padLabel, type PadProfiles } from '../../input/GamepadProfile'
import { faceKey, type GenerationJobs } from '../../app/GenerationJobs'
import { intentFromInput, type CombatEvent } from '../../combat/CombatWorld'
import { MatchController, ROUND_TICKS } from '../../match/MatchController'
import { practiceTick } from '../../match/practice'
import { FIXED_STEP_MS, type GameClock } from '../../time/GameClock'
import type { PresentationContext } from '../animation/TemporarySpriteManifest'
import { BattleView } from '../battle/BattleView'
import { ActionButton, AngularPanel, KeyCap } from '../VisualComponents'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { LOADING_TITLE, loadingStatus } from '../ViewModels'
import { resolveStageAsset } from '../assets/TestAssetManifest'
import { ArenaScreen, type Matchup, type ScreenContext } from './ScreenView'

export type LoadingOptions = { matchup: Matchup; controls: ControlProfiles; pads: PadProfiles; input: InputManager; clock: GameClock; jobs: GenerationJobs; retry: () => boolean }

/** P3 練習場：生成與素材載入期間可自由練習（獨立的練習對戰，不計分）；都完成後 FIGHT! 才可按，失敗時同一顆按鈕變成重試。 */
export class LoadingScreen extends ArenaScreen {
  ready?: boolean
  private readonly practice = new MatchController()
  private readonly view: BattleView
  private readonly events: CombatEvent[] = []
  private readonly unsubscribe: () => void
  private readonly playerContext: PresentationContext = {}
  private readonly enemyContext: PresentationContext = {}
  private promptDevice?: string
  private readonly button: ActionButton
  private readonly title: Phaser.GameObjects.Text
  private readonly bar: Phaser.GameObjects.Rectangle
  private readonly percent: Phaser.GameObjects.Text
  private readonly keyCaps: KeyCap[] = []
  private face?: Phaser.GameObjects.Image
  private pulse?: Phaser.Tweens.Tween

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, private readonly options: LoadingOptions) {
    super(ctx, root, options.matchup.stageId, uiTokens.backdrop.battle)
    const { scene } = this, { colors } = uiTokens, { matchup, controls, pads } = options
    const config = this.practice.world.getConfig()
    this.unsubscribe = this.practice.world.subscribe((event) => { this.events.push(event) })
    this.practice.start()
    this.view = new BattleView(scene, this.arena, this.stage.world, { stage: matchup.stageId, playerSprite: matchup.playerSprite, enemySprite: matchup.enemySprite, playerName: matchup.playerName, enemyName: matchup.enemyName, twoPlayer: matchup.twoPlayer, floorY: config.floorY, maxHp: config.maxHp, input: options.input, audio: ctx.audio, combat: this.practice.world })
    this.view.update(this.practice.getSnapshot(), [], this.playerContext, undefined, this.enemyContext)

    const key = (...actions: CombatAction[]): string => actions.map((action) => keyLabel(controls.P1[action])).join(' ')
    const padKey = (...actions: CombatAction[]): string => actions.map((action) => padLabel(pads.P1[action])).join(' ')
    const panel = new AngularPanel(scene, 1040, 150, colors.panelRaised).setPosition(560, 985)
    panel.add(scene.add.text(-490, -50, `PRACTICE ・ 練習場  ·  ${resolveStageAsset(matchup.stageId).label}  ·  ${key('CROUCH')} 蹲 · 後退＝防禦`, { ...typography.note, color: colorHex('statusLime') }).setOrigin(0, 0.5))
    const bindings = [['MOVE', key('MOVE_LEFT', 'MOVE_RIGHT'), padKey('MOVE_LEFT', 'MOVE_RIGHT')], ['JUMP', key('JUMP'), padKey('JUMP')], ['PUNCH', key('LIGHT_PUNCH', 'HEAVY_PUNCH'), padKey('LIGHT_PUNCH', 'HEAVY_PUNCH')], ['KICK', key('LIGHT_KICK', 'HEAVY_KICK'), padKey('LIGHT_KICK', 'HEAVY_KICK')]]
    bindings.forEach(([action, keyboard, pad], i) => {
      const x = -490 + i * 255
      const keyboardCap = new KeyCap(scene, keyboard, 'keyboard').setPosition(x + 115, 20), padCap = new KeyCap(scene, pad, 'gamepad').setPosition(x + 200, 20)
      panel.add([scene.add.text(x, 20, action, typography.note).setOrigin(0, 0.5), keyboardCap, padCap]); this.keyCaps.push(keyboardCap, padCap)
    })
    root.add(panel)

    const loading = new AngularPanel(scene, 680, 150, colors.panelRaised).setPosition(1540, 985)
    this.title = scene.add.text(-315, -45, LOADING_TITLE.LOADING.text, typography.note).setOrigin(0, 0.5)
    this.bar = scene.add.rectangle(-315, 15, 300, 12, colors.systemBlue).setOrigin(0, 0.5)
    this.percent = scene.add.text(-315, 45, '', typography.note).setOrigin(0, 0.5)
    this.button = new ActionButton(scene, 'FIGHT!', 300, 92, colors.playerPrimary, `${keyLabel(controls.P1.LIGHT_PUNCH)} / ENTER / ${padLabel(pads.P1.LIGHT_KICK)}`).setPosition(165, 0).setEnabled(false)
    const fight = (): void => { if (!options.retry() && this.ready) ctx.go(AppState.BATTLE) }
    this.button.on('pointerup', fight)
    loading.add([this.title, scene.add.rectangle(-315, 15, 300, 12, colors.background0).setOrigin(0, 0.5), this.bar, this.percent, this.button]); root.add(loading)
    this.focusable('loading', 'loading-fight', this.button, fight, false)
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

  private refresh(): void {
    const { scene, options: { jobs } } = this
    // 生成中在狀態列左側顯示拍攝頭像（只顯示 1P；2P 的生成狀態併在同一條狀態）。
    if (!this.face && jobs.has('P1') && scene.textures.exists(faceKey('P1'))) { this.face = scene.add.image(1130, 985, faceKey('P1')).setDisplaySize(80, 80); this.root.add(this.face) }
    const boot = scene.scene.get('BootScene').load
    const generationFailed = jobs.failed, assetFailed = jobs.assets === 'failed', generating = jobs.generating
    const busy = boot.isLoading() || scene.load.isLoading() || generating || jobs.assets === 'idle' || jobs.assets === 'loading'
    const progress = busy ? (scene.load.isLoading() ? scene.load.progress : boot.progress) : 1
    this.bar.setScale(generating ? 0.5 : progress, 1)
    this.percent.setText(generationFailed ? '生成失敗 · 可重試' : assetFailed ? '載入失敗 · 可重試' : generating ? '角色生成中 · 先練習' : busy ? Math.round(progress * 100) + '%' : 'READY · 可開戰')
    this.button.label.setText(generationFailed || assetFailed ? 'RETRY · 重試' : 'FIGHT!')
    const status = LOADING_TITLE[loadingStatus({ busy, generating, failed: generationFailed || assetFailed })]
    this.title.setText(status.text).setColor(colorHex(status.color))
    const ready = !busy && !generationFailed && !assetFailed
    // 失敗時按鈕仍可按（＝重試），只有忙碌中停用。
    if (this.ready !== ready || this.button.input?.enabled !== !busy) {
      this.ready = ready; this.button.setEnabled(!busy); this.ctx.ui.focus.setEnabled('loading', 'loading-fight', !busy)
      this.pulse?.stop(); this.button.label.setAlpha(1)
      if (!busy) { this.ctx.ui.focus.activate('loading', 'loading-fight'); this.pulse = this.tween({ targets: this.button.label, alpha: 0.7, duration: 700, yoyo: true, repeat: -1 }) }
    }
    const device = this.options.input.lastDevice()
    if (device !== this.promptDevice) { this.promptDevice = device; this.keyCaps.forEach((cap) => cap.setEmphasis(cap.device === device)) }
  }
}
