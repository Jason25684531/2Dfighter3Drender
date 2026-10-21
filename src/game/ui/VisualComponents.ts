import Phaser from 'phaser'
import { colorHex, reducedMotion, uiTokens } from './tokens/uiTokens'
import { typography } from './tokens/typography'
import { stopOwnedTweens } from './tweens'
import { bannerTextAt, healthRatio, panelPoints, type BannerStep } from './presentationMath'

export class AngularPanel extends Phaser.GameObjects.Container {
  readonly shape: Phaser.GameObjects.Polygon
  private readonly focusGlow: Phaser.GameObjects.Polygon
  private focusTween?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene, width: number, height: number, color: number = uiTokens.colors.panel, alpha: number = uiTokens.opacity.panel, options: { shape?: 'slant' | 'chamfer'; slant?: number } = {}) {
    super(scene, 0, 0)
    const points = panelPoints(width, height, options.slant ?? uiTokens.slant, options.shape)
    this.focusGlow = scene.add.polygon(0, 0, points, color, 0).setOrigin(0).setStrokeStyle(12, uiTokens.colors.playerPrimary, 0)
    this.shape = scene.add.polygon(0, 0, points, color, alpha).setOrigin(0).setStrokeStyle(2, uiTokens.colors.lineBright, 0.7)
    this.add([this.focusGlow, this.shape]).setSize(width, height)
  }
  setFocused(focused: boolean, scale: number = uiTokens.focusScale, inactiveAlpha: number = uiTokens.opacity.inactive): this {
    if (this.focusTween) stopOwnedTweens([this.focusTween])
    this.shape.setStrokeStyle(focused ? 3 : 2, focused ? uiTokens.colors.focus : uiTokens.colors.lineBright, focused ? 1 : 0.7)
    this.focusGlow.setStrokeStyle(12, uiTokens.colors.playerPrimary, focused ? 0.25 : 0)
    const values = { scaleX: focused ? scale : 1, scaleY: focused ? scale : 1, alpha: focused ? 1 : inactiveAlpha }
    if (reducedMotion) Object.assign(this, values)
    else this.focusTween = this.scene.tweens.add({ targets: this, ...values, duration: uiTokens.motion.fast, ease: 'Cubic.Out' })
    return this
  }
  destroy(fromScene?: boolean): void { if (this.focusTween) stopOwnedTweens([this.focusTween]); super.destroy(fromScene) }
}

export class ActionButton extends AngularPanel {
  readonly label: Phaser.GameObjects.Text
  private glow?: Phaser.FX.Glow
  constructor(scene: Phaser.Scene, text: string, width = 380, height = 88, color: number = uiTokens.colors.playerPrimary, subtitle = '') {
    super(scene, width, height, color, 0.96)
    if (color === uiTokens.colors.playerPrimary && scene.game.renderer.type === Phaser.WEBGL) {
      const gradient = scene.add.graphics().fillGradientStyle(color, 0x840c20, color, 0x840c20).fillPoints(panelPoints(width, height, uiTokens.slant).reduce<Phaser.Math.Vector2[]>((points, value, i, all) => { if (i % 2 === 0) points.push(new Phaser.Math.Vector2(value, all[i + 1])); return points }, []), true)
      this.addAt(gradient, 1)
      this.shape.setFillStyle(color, 0)
      this.glow = this.postFX.addGlow(uiTokens.colors.playerPrimary, 0, 0, false, 0.1, 8)
      if (!reducedMotion) gradient.postFX.addShine(0.3, 0.2, 3)
    }
    this.label = scene.add.text(0, subtitle ? -12 : 0, text, typography.action).setOrigin(0.5)
    this.add(this.label)
    if (subtitle) this.add(scene.add.text(0, 27, subtitle, { ...typography.note, fontFamily: uiTokens.fonts.zh, color: colorHex('textPrimary') }).setOrigin(0.5))
    this.setInteractive({ useHandCursor: true })
  }
  setFocused(focused: boolean): this { super.setFocused(focused); if (this.glow) this.glow.outerStrength = focused ? 2 : 0; return this }
  setEnabled(enabled: boolean): this { this.setAlpha(enabled ? 1 : 0.4); if (this.input) this.input.enabled = enabled; return this }
}

export class StageCard extends AngularPanel {
  readonly image: Phaser.GameObjects.Image
  private readonly selectedBand: Phaser.GameObjects.Graphics
  constructor(scene: Phaser.Scene, label: string, texture: string, width = 780, height = 500, subtitle = '') {
    super(scene, width, height, uiTokens.colors.panelRaised, 0.96, { slant: 48 })
    this.setAlpha(uiTokens.opacity.inactive)
    this.image = scene.add.image(0, -40, texture).setDisplaySize(width - 64, height - 140)
    this.add(this.image)
    this.selectedBand = scene.add.graphics().setPosition(0, height / 2 - 60).setVisible(false)
    if (scene.game.renderer.type === Phaser.WEBGL) this.selectedBand.fillGradientStyle(uiTokens.colors.playerPrimary, 0x840c20, uiTokens.colors.playerPrimary, 0x840c20)
    else this.selectedBand.fillStyle(uiTokens.colors.playerPrimary)
    this.selectedBand.fillPoints([{ x: -width / 2 + 12, y: -50 }, { x: width / 2 - 36, y: -50 }, { x: width / 2 - 48, y: 50 }, { x: -width / 2, y: 50 }], true)
    this.add(this.selectedBand)
    this.add(scene.add.text(0, height / 2 - 72, label, typography.action).setOrigin(0.5))
    this.add(scene.add.text(0, height / 2 - 28, subtitle, typography.instruction).setOrigin(0.5))
  }
  setSelected(selected: boolean): this { this.selectedBand.setVisible(selected); return this }
  setFocused(focused: boolean): this { super.setFocused(focused, uiTokens.stageFocusScale, 0.78); this.image.setAlpha(focused ? 1 : 0.7); return this }
}

export class HealthBar extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.Rectangle
  private readonly lag: Phaser.GameObjects.Rectangle
  private readonly value: Phaser.GameObjects.Text
  private chase?: Phaser.Tweens.Tween
  private ratio = 1
  constructor(scene: Phaser.Scene, width: number, color: number, reverse = false) {
    super(scene, 0, 0)
    const x = reverse ? width : 0, origin = reverse ? 1 : 0
    this.add(scene.add.rectangle(x, 0, width, 32, uiTokens.colors.background0).setOrigin(origin, 0.5).setStrokeStyle(2, uiTokens.colors.lineBright))
    this.lag = scene.add.rectangle(x, 0, width, 26, 0xffffff, 0.25).setOrigin(origin, 0.5)
    this.fill = scene.add.rectangle(x, 0, width, 26, color).setOrigin(origin, 0.5)
    this.value = scene.add.text(reverse ? 0 : width, -30, '100', typography.note).setOrigin(reverse ? 0 : 1, 0.5)
    this.add([this.lag, this.fill, this.value])
  }
  setRatio(ratio: number, hp = Math.round(healthRatio(ratio) * 100)): this {
    ratio = healthRatio(ratio); this.value.setText(String(hp))
    if (ratio === this.ratio) return this
    if (this.chase) stopOwnedTweens([this.chase])
    this.fill.setScale(ratio, 1)
    if (ratio > this.ratio || reducedMotion) this.lag.setScale(ratio, 1)
    else this.chase = this.scene.tweens.add({ targets: this.lag, scaleX: ratio, duration: 600 })
    this.ratio = ratio; return this
  }
  destroy(fromScene?: boolean): void { if (this.chase) stopOwnedTweens([this.chase]); super.destroy(fromScene) }
}

export class RoundDiamonds extends Phaser.GameObjects.Container {
  private readonly markers: Phaser.GameObjects.Rectangle[]
  constructor(scene: Phaser.Scene, reverse = false) {
    super(scene, 0, 0)
    this.markers = [0, 1].map(i => scene.add.rectangle((reverse ? -1 : 1) * i * 44, 0, 24, 24, uiTokens.colors.lineDim).setRotation(Math.PI / 4).setStrokeStyle(2, uiTokens.colors.lineBright))
    this.add(this.markers)
  }
  setWins(wins: number): void { this.markers.forEach((marker, i) => marker.setFillStyle(i < wins ? uiTokens.colors.resultGold : uiTokens.colors.lineDim)) }
}

export class HexTimer extends Phaser.GameObjects.Container {
  private readonly value: Phaser.GameObjects.Text
  private readonly round: Phaser.GameObjects.Text
  private lastSecond?: number
  private pulse?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0)
    this.add(scene.add.polygon(0, 0, [-65,-70,65,-70,88,0,65,70,-65,70,-88,0], uiTokens.colors.panelRaised).setOrigin(0).setStrokeStyle(2, uiTokens.colors.lineBright))
    this.value = scene.add.text(0, -14, '60', typography.timer).setOrigin(0.5)
    this.round = scene.add.text(0, 45, 'ROUND 1', typography.note).setOrigin(0.5)
    this.add([this.value, this.round])
  }
  updateTime(seconds: number, round: number): void {
    this.value.setText(String(seconds).padStart(2, '0')).setColor(colorHex(seconds <= 10 ? 'danger' : 'textPrimary')); this.round.setText(`ROUND ${round}`)
    if (seconds <= 10 && seconds !== this.lastSecond && !reducedMotion) { if (this.pulse) stopOwnedTweens([this.pulse]); this.value.setScale(1); this.pulse = this.scene.tweens.add({ targets: this.value, scale: 1.12, duration: 150, yoyo: true }) }
    this.lastSecond = seconds
  }
  destroy(fromScene?: boolean): void { if (this.pulse) stopOwnedTweens([this.pulse]); super.destroy(fromScene) }
}

export class KeyCap extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, key: string, readonly device: 'keyboard' | 'gamepad') {
    super(scene, 0, 0)
    const color = key === 'A' ? uiTokens.colors.statusLime : key === 'X' ? uiTokens.colors.systemBlue : uiTokens.colors.resultGold
    const width = Math.max(42, key.length * 13 + 16)
    this.add(device === 'gamepad' && key.length <= 2 ? scene.add.circle(0, 0, 23, uiTokens.colors.background0).setStrokeStyle(2, color) : scene.add.rectangle(0, 0, width, 46, uiTokens.colors.background0).setStrokeStyle(2, uiTokens.colors.lineBright))
    this.add(scene.add.text(0, 0, key, { ...typography.note, color: device === 'gamepad' ? `#${color.toString(16)}` : colorHex('textPrimary') }).setOrigin(0.5))
  }
  setEmphasis(emphasized: boolean): void { this.setAlpha(emphasized ? 1 : 0.48) }
}

export class RoundBanner extends Phaser.GameObjects.Container {
  private readonly label: Phaser.GameObjects.Text
  private steps: readonly BannerStep[] = []
  private started = 0
  constructor(scene: Phaser.Scene) {
    super(scene, 960, 360)
    this.add(new AngularPanel(scene, 1400, 120, uiTokens.colors.playerPrimary, 0.68))
    this.label = scene.add.text(0, 0, '', { ...typography.announcer, fontSize: uiTokens.type.h1 }).setOrigin(0.5)
    this.add(this.label).setVisible(false)
  }
  show(steps: readonly BannerStep[], tick: number): void { this.steps = steps; this.started = tick; this.updateTick(tick) }
  updateTick(tick: number): void { const text = bannerTextAt(this.steps, tick - this.started); this.label.setText(text); this.setVisible(Boolean(text)) }
}

export const addFocalGlow = (scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, width: number, height: number, color: number, alpha: number = uiTokens.opacity.focusGlow): Phaser.GameObjects.Graphics => {
  const glow = scene.add.graphics().setPosition(x, y)
  ;[1, 0.76, 0.52, 0.28].forEach((scale, index) => glow.fillStyle(color, alpha * (0.16 + index * 0.12)).fillEllipse(0, 0, width * scale, height * scale))
  parent.add(glow); return glow
}
export const fighterSilhouette = (scene: Phaser.Scene, x: number, y: number, width: number, height: number, color: number, alpha = 0.38): Phaser.GameObjects.Graphics => {
  const silhouette = scene.add.graphics().setPosition(x, y)
  silhouette.fillStyle(color, alpha).fillEllipse(0, -height * 0.23, width * 0.31, height * 0.28)
  silhouette.fillStyle(color, alpha * 0.82).fillEllipse(0, height * 0.16, width * 0.92, height * 0.58)
  silhouette.fillStyle(color, alpha * 0.54).fillRoundedRect(-width * 0.29, height * 0.22, width * 0.58, height * 0.39, Math.min(16, width * 0.08))
  return silhouette
}
