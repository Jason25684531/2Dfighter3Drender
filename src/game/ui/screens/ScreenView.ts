import Phaser from 'phaser'
import type { AppState } from '../../state/AppState'
import type { UIAction } from '../../input/InputManager'
import type { UIFramework } from '../UIFramework'
import type { GameAudio } from '../../audio/GameAudio'
import { stopOwnedTweens } from '../tweens'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { BattleStage } from '../stage/BattleStage'
import type { StageId } from '../assets/TestAssetManifest'

export type Focusable = Phaser.GameObjects.Container & { setFocused: (focused: boolean) => unknown }

/** AppScene 建立一次、交給每個畫面的共用服務。畫面不直接碰狀態機或輸入管理。 */
export type ScreenContext = {
  scene: Phaser.Scene
  ui: UIFramework
  audio?: GameAudio
  go: (state: AppState) => void
  register: (group: string, id: string, object: Focusable, activate: () => void, enabled?: boolean) => void
}

/** P0–P7 共同的生命週期：建構＝進入、tick／update＝每步／每幀、destroy＝離開。畫面私有的物件、動畫與焦點都隨 destroy 釋放。 */
export abstract class ScreenView {
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private readonly focusGroups = new Set<string>()

  constructor(protected readonly ctx: ScreenContext, readonly root: Phaser.GameObjects.Container) {
    if (root.alpha < 1) this.tween({ targets: root, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' })
  }

  protected get scene(): Phaser.Scene { return this.ctx.scene }

  /** 回傳 true 表示畫面已處理，AppScene 不再交給預設導覽。 */
  handleAction(_action: UIAction): boolean { return false }
  /** 每個固定步長（GameClock tick）。 */
  tick(): void {}
  /** 每個 Phaser 影格。 */
  update(_deltaMs: number): void {}

  destroy(): void {
    stopOwnedTweens(this.tweens)
    this.focusGroups.forEach((group) => this.ctx.ui.focus.clearGroup(group))
    this.root.destroy(true)
  }

  protected tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Phaser.Tweens.Tween | undefined {
    if (reducedMotion && config.repeat === -1) return undefined
    const tween = this.scene.tweens.add(reducedMotion ? { ...config, duration: 0, delay: 0 } : config)
    this.tweens.push(tween)
    tween.once('complete', () => { const index = this.tweens.indexOf(tween); if (index >= 0) this.tweens.splice(index, 1) })
    return tween
  }

  protected focusable(group: string, id: string, object: Focusable, activate: () => void, enabled = true): void {
    this.focusGroups.add(group)
    this.ctx.register(group, id, object, activate, enabled)
  }

  protected heading(text: string, x = 110, y = 112): Phaser.GameObjects.Text { return this.scene.add.text(x, y, text, typography.heading).setOrigin(0, 0.5) }
  protected label(text: string, x: number, y: number, size: number = uiTokens.type.body, color = colorHex('textSecondary')): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, { ...typography.note, fontSize: size, color }).setOrigin(0.5)
  }
}

/** 場景暗化＋玩家／敵方色漸層＋上下暈影；選單背景與戰鬥舞台共用。 */
export const addAtmosphere = (scene: Phaser.Scene, container: Phaser.GameObjects.Container, darkness: number): void => {
  const { colors, opacity } = uiTokens
  container.add(scene.add.rectangle(960, 540, 1920, 1080, colors.background0, darkness))
  const atmosphere = scene.add.graphics()
  atmosphere.fillGradientStyle(colors.playerPrimary, colors.background0, colors.enemyPrimary, colors.background0, 0.1, 0, 0.08, 0).fillRect(0, 0, 1920, 1080)
  atmosphere.fillGradientStyle(colors.background0, colors.background0, colors.background0, colors.background1, opacity.vignette, opacity.vignette, 0, 0).fillRect(0, 0, 1920, 170)
  atmosphere.fillGradientStyle(colors.background1, colors.background0, colors.background0, colors.background0, 0, 0, opacity.vignette, opacity.vignette).fillRect(0, 900, 1920, 180)
  container.add(atmosphere)
}

/** P4／P5 共用：視差舞台與角色所在的世界容器。 */
export abstract class ArenaScreen extends ScreenView {
  readonly stage: BattleStage
  protected readonly arena: Phaser.GameObjects.Container

  constructor(ctx: ScreenContext, root: Phaser.GameObjects.Container, stageId: StageId, darkness: number) {
    super(ctx, root)
    this.arena = ctx.scene.add.container(0, 0)
    root.add(this.arena)
    this.stage = new BattleStage(ctx.scene, this.arena, stageId, reducedMotion, () => addAtmosphere(ctx.scene, this.arena, darkness))
  }

  destroy(): void { this.stage.destroy(); super.destroy() }
}
