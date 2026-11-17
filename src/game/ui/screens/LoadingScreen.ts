import type Phaser from 'phaser'
import { AppState } from '../../state/AppState'
import type { InputManager } from '../../input/InputManager'
import { keyLabel, type CombatAction, type ControlProfiles } from '../../input/ControlProfile'
import { padLabel, type PadProfiles } from '../../input/GamepadProfile'
import { faceKey, type GenerationJobs } from '../../app/GenerationJobs'
import { ActionButton, AngularPanel, KeyCap } from '../VisualComponents'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { loadingViewModel } from '../ViewModels'
import { resolveStageAsset } from '../assets/TestAssetManifest'
import { spriteTextureFrame, spriteTextureKey, type SpriteId } from '../animation/TemporarySpriteManifest'
import { isSheetSprite } from '../animation/SheetSpriteManifest'
import { ScreenView, type Matchup, type ScreenContext } from './ScreenView'

export type LoadingOptions = { matchup: Matchup; controls: ControlProfiles; pads: PadProfiles; input: InputManager; jobs: GenerationJobs; retry: () => boolean }

/** P3：VS 構圖、操作說明與載入進度。素材與生成都完成後 FIGHT! 才可按；失敗時同一顆按鈕變成重試。 */
export class LoadingScreen extends ScreenView {
  ready?: boolean
  promptDevice?: string
  private readonly button: ActionButton
  private readonly bar: Phaser.GameObjects.Rectangle
  private readonly percent: Phaser.GameObjects.Text
  private readonly keyCaps: KeyCap[] = []
  private readonly portraits = new Set<'P1' | 'P2'>()
  private pulse?: Phaser.Tweens.Tween

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, private readonly options: LoadingOptions) {
    super(ctx, root)
    const { scene } = this, { colors, type } = uiTokens, { matchup, controls, pads } = options
    const vm = loadingViewModel(matchup.player, matchup.enemyName, resolveStageAsset(matchup.stageId).label, 1, matchup.playerName)
    root.add(scene.add.graphics().lineStyle(8, colors.systemBlue, 0.4).lineBetween(1100, 0, 820, 710))
    this.addPreview(vm.character.spriteId, 430)
    this.addPreview(matchup.enemySprite, 1480)?.setFlipX(true)
    root.add(scene.add.text(130, 565, 'PLAYER', { ...typography.note, color: colorHex('playerGlow') }))
    root.add(scene.add.text(130, 600, vm.playerName, typography.title))
    if (vm.character.type === 'BODY_TEMPLATE') root.add(scene.add.text(130, 680, vm.character.displayName + ' · TEMP BODY', { ...typography.note, color: colorHex('resultGold') }))
    root.add(scene.add.text(1780, 565, matchup.twoPlayer ? 'ENEMY · 2P' : 'ENEMY · CPU', { ...typography.note, color: colorHex('enemyGlow') }).setOrigin(1, 0))
    root.add(scene.add.text(1780, 600, vm.enemyName, typography.title).setOrigin(1, 0))
    root.add(scene.add.text(960, 330, 'VS', { ...typography.title, fontSize: type.hero, stroke: colorHex('systemBlue'), strokeThickness: 8 }).setOrigin(0.5).setRotation(-0.08))
    root.add(this.label(vm.stage, 960, 670, type.body))

    const panel = new AngularPanel(scene, 1030, 294, colors.panelRaised).setPosition(620, 865)
    panel.add(scene.add.text(-465, -120, 'CONTROLS ・ 操作說明', typography.secondaryAction))
    const key = (...actions: CombatAction[]): string => actions.map((action) => keyLabel(controls.P1[action])).join(' ')
    const padKey = (...actions: CombatAction[]): string => actions.map((action) => padLabel(pads.P1[action])).join(' ')
    panel.add(scene.add.text(475, -112, `${key('CROUCH')} 蹲 · 按住 ${key('CROUCH')}／← 後退＝防禦 · ${key('PAUSE')} 暫停`, typography.note).setOrigin(1, 0))
    const bindings = [['MOVE', key('MOVE_LEFT', 'MOVE_RIGHT'), padKey('MOVE_LEFT', 'MOVE_RIGHT')], ['JUMP', key('JUMP'), padKey('JUMP')], ['PUNCH', key('LIGHT_PUNCH', 'HEAVY_PUNCH'), padKey('LIGHT_PUNCH', 'HEAVY_PUNCH')], ['KICK', key('LIGHT_KICK', 'HEAVY_KICK'), padKey('LIGHT_KICK', 'HEAVY_KICK')]]
    bindings.forEach(([action, keyboard, pad], i) => {
      const x = -455 + (i % 2) * 500, y = -25 + Math.floor(i / 2) * 104
      panel.add(scene.add.text(x, y - 35, action, typography.note))
      const keyboardCap = new KeyCap(scene, keyboard, 'keyboard').setPosition(x + 90, y + 15)
      const padCap = new KeyCap(scene, pad, 'gamepad').setPosition(x + 320, y + 15)
      panel.add([keyboardCap, padCap]); this.keyCaps.push(keyboardCap, padCap)
    })
    root.add(panel)

    const loading = new AngularPanel(scene, 640, 294, colors.panelRaised).setPosition(1495, 865)
    loading.add(scene.add.text(-260, -120, 'LOADING ・ 載入中', typography.secondaryAction))
    loading.add(scene.add.rectangle(0, -40, 520, 14, colors.background0))
    this.bar = scene.add.rectangle(-260, -40, 520, 14, colors.systemBlue).setOrigin(0, 0.5)
    this.percent = scene.add.text(260, -82, '', typography.note).setOrigin(1, 0.5)
    this.button = new ActionButton(scene, 'FIGHT!', 440, 92, colors.playerPrimary, `ENTER / ${padLabel(pads.P1.LIGHT_KICK)} ・ 開始`).setPosition(0, 55).setEnabled(false)
    const fight = (): void => { if (!options.retry() && this.ready) ctx.go(AppState.BATTLE) }
    this.button.on('pointerup', fight)
    loading.add([this.bar, this.percent, this.button]); root.add(loading)
    this.focusable('loading', 'loading-fight', this.button, fight, false)
    this.update()
  }

  update(): void {
    const { scene, options: { jobs } } = this
    ;(['P1', 'P2'] as const).forEach((id, i) => {
      if (!jobs.has(id) || this.portraits.has(id) || !scene.textures.exists(faceKey(id))) return
      this.root.add(scene.add.image(1215 + i * 92, 670, faceKey(id)).setDisplaySize(80, 80))
      this.portraits.add(id)
    })
    const boot = scene.scene.get('BootScene').load
    const generationFailed = jobs.failed, assetFailed = jobs.assets === 'failed', generating = jobs.generating
    const busy = boot.isLoading() || scene.load.isLoading() || generating || jobs.assets === 'loading'
    const progress = busy ? (scene.load.isLoading() ? scene.load.progress : boot.progress) : 1
    this.bar.setScale(generating ? 0.5 : progress, 1)
    this.percent.setText(generationFailed ? '角色生成失敗 · 可重試或返回' : assetFailed ? '素材載入失敗 · 可重試' : generating ? '角色生成中' : busy ? Math.round(progress * 100) + '%' : 'READY')
    this.button.label.setText(generationFailed || assetFailed ? 'RETRY · 重試' : 'FIGHT!')
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

  private addPreview(spriteId: SpriteId | undefined, x: number): Phaser.GameObjects.Sprite | undefined {
    const key = spriteId && spriteTextureKey(spriteId, 'idle')
    if (!key || !this.scene.textures.exists(key)) return undefined
    const image = this.scene.add.sprite(x, 360, key, spriteTextureFrame(spriteId)).setDisplaySize(700, 700)
    if (isSheetSprite(spriteId) && !reducedMotion && this.scene.anims.exists(`${spriteId}-idle`)) image.play(`${spriteId}-idle`)
    this.root.add(image)
    return image
  }
}
