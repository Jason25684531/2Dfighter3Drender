import Phaser from 'phaser'
import { colorHex, uiTokens } from './tokens/uiTokens'
import { typography } from './tokens/typography'
import { stopOwnedTweens } from './tweens'

export class AngularPanel extends Phaser.GameObjects.Container {
  readonly shape: Phaser.GameObjects.Polygon
  private readonly inner: Phaser.GameObjects.Polygon
  private readonly focusGlow: Phaser.GameObjects.Polygon
  private readonly underbar: Phaser.GameObjects.Rectangle
  private focusTween?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene, width: number, height: number, color: number = uiTokens.colors.panel, alpha: number = uiTokens.opacity.panel) {
    super(scene, 0, 0)
    const cut = Math.min(uiTokens.chamfer, width / 8, height / 8)
    const points = (inset = 0): number[] => [-width / 2 + cut, -height / 2 + inset, width / 2 - inset, -height / 2 + inset, width / 2 - inset, height / 2 - cut, width / 2 - cut, height / 2 - inset, -width / 2 + inset, height / 2 - inset, -width / 2 + inset, -height / 2 + cut]
    this.focusGlow = scene.add.polygon(0, 0, points(), uiTokens.colors.playerGlow, 0).setOrigin(0, 0).setStrokeStyle(uiTokens.glowWidth.focus, uiTokens.colors.playerPrimary, 0)
    this.shape = scene.add.polygon(0, 0, points(), color, alpha).setOrigin(0, 0).setStrokeStyle(uiTokens.borderWidth.standard, uiTokens.colors.lineBright, 0.9)
    this.inner = scene.add.polygon(0, 0, points(5), color, 0).setOrigin(0, 0).setStrokeStyle(uiTokens.borderWidth.quiet, uiTokens.colors.textPrimary, 0.12)
    this.underbar = scene.add.rectangle(0, height / 2 - 4, Math.min(96, width * 0.24), 3, uiTokens.colors.playerGlow, 0).setOrigin(0.5)
    this.add([this.focusGlow, this.shape, this.inner, this.underbar]).setSize(width, height)
  }
  setFocused(focused: boolean, scale: number = uiTokens.focusScale, inactiveAlpha: number = uiTokens.opacity.inactive): this {
    if (this.focusTween) stopOwnedTweens([this.focusTween])
    this.shape.setStrokeStyle(focused ? uiTokens.borderWidth.focus : uiTokens.borderWidth.standard, focused ? uiTokens.colors.focus : uiTokens.colors.lineBright, focused ? 1 : 0.9)
    this.inner.setStrokeStyle(uiTokens.borderWidth.quiet, focused ? uiTokens.colors.playerGlow : uiTokens.colors.textPrimary, focused ? 0.5 : 0.12)
    this.focusGlow.setStrokeStyle(uiTokens.glowWidth.focus, uiTokens.colors.playerPrimary, focused ? uiTokens.opacity.focusGlow : 0)
    this.underbar.setFillStyle(uiTokens.colors.playerGlow, focused ? 1 : 0)
    this.focusTween = this.scene.tweens.add({ targets: this, scaleX: focused ? scale : 1, scaleY: focused ? scale : 1, alpha: focused ? 1 : inactiveAlpha, duration: uiTokens.motionMs.focus, ease: 'Cubic.Out' })
    return this
  }
  destroy(fromScene?: boolean): void { if (this.focusTween) stopOwnedTweens([this.focusTween]); this.focusTween = undefined; super.destroy(fromScene) }
}

export class ActionButton extends AngularPanel {
  readonly label: Phaser.GameObjects.Text
  constructor(scene: Phaser.Scene, text: string, width = 320, height = 76, color: number = uiTokens.colors.playerPrimary) {
    super(scene, width, height, color, 0.96)
    this.label = scene.add.text(0, 0, text, { ...typography.action, fontSize: `${Math.max(36, Math.min(48, height * 0.55))}px` }).setOrigin(0.5)
    this.add(this.label).setInteractive({ useHandCursor: true })
  }
  setEnabled(enabled: boolean): this { this.setAlpha(enabled ? 1 : 0.4); return this }
}

export class CharacterCard extends AngularPanel {
  readonly label: Phaser.GameObjects.Text
  readonly nameText: Phaser.GameObjects.Text
  constructor(scene: Phaser.Scene, label: string, nickname: string, custom = false, portraitTexture?: string) {
    super(scene, 248, 310, custom ? uiTokens.colors.background1 : uiTokens.colors.panelRaised)
    const portrait = scene.add.graphics().setPosition(0, -39)
    portrait.fillStyle(custom ? uiTokens.colors.background0 : uiTokens.colors.background1, 0.88).fillRect(-112, -116, 224, 232)
    const silhouette = fighterSilhouette(scene, 0, -31, 210, 180, custom ? uiTokens.colors.textSecondary : uiTokens.colors.textPrimary, custom ? 0.2 : 0.42)
    const image = portraitTexture && scene.textures.exists(portraitTexture) ? scene.add.image(0, -40, portraitTexture).setDisplaySize(220, 220) : undefined
    silhouette.setVisible(!image)
    const rail = scene.add.rectangle(0, 115, 232, 80, uiTokens.colors.background0, 0.94).setStrokeStyle(1, uiTokens.colors.lineBright, 0.65)
    this.label = scene.add.text(custom ? 0 : -106, 86, custom ? '+' : label, { ...typography.action, fontSize: custom ? '44px' : '16px', color: custom ? colorHex('playerGlow') : colorHex('textSecondary') }).setOrigin(custom ? 0.5 : 0, 0.5)
    this.nameText = scene.add.text(custom ? 0 : -106, 124, custom ? 'CUSTOM' : nickname, { ...typography.note, color: colorHex('textPrimary'), fontSize: custom ? '20px' : '18px', fontStyle: 'bold' }).setOrigin(custom ? 0.5 : 0, 0.5)
    this.add([portrait, silhouette, ...(image ? [image] : []), rail, this.label, this.nameText])
    if (custom) {
      this.shape.setStrokeStyle(uiTokens.borderWidth.standard, uiTokens.colors.playerGlow, 0.68)
      const corners = scene.add.graphics().lineStyle(uiTokens.borderWidth.focus, uiTokens.colors.playerGlow, 0.9)
      const left = -116; const right = 116; const top = -150; const bottom = 74; const mark = 20
      corners.lineBetween(left, top, left + mark, top).lineBetween(left, top, left, top + mark)
      corners.lineBetween(right - mark, top, right, top).lineBetween(right, top, right, top + mark)
      corners.lineBetween(left, bottom - mark, left, bottom).lineBetween(left, bottom, left + mark, bottom)
      corners.lineBetween(right - mark, bottom, right, bottom).lineBetween(right, bottom - mark, right, bottom)
      this.add(corners)
    }
  }
}

export class StageCard extends AngularPanel {
  readonly image: Phaser.GameObjects.Image
  readonly label: Phaser.GameObjects.Text
  constructor(scene: Phaser.Scene, label: string, texture: string, width = 760, height = 500) {
    super(scene, width, height, uiTokens.colors.panelRaised)
    this.image = scene.add.image(0, -30, texture)
    const imageWidth = width - 32
    const imageHeight = height - 96
    const scale = Math.max(imageWidth / this.image.width, imageHeight / this.image.height)
    this.image.setScale(scale)
    this.image.setCrop((this.image.width - imageWidth / scale) / 2, (this.image.height - imageHeight / scale) / 2, imageWidth / scale, imageHeight / scale)
    this.label = scene.add.text(0, height / 2 - 39, label, { ...typography.secondaryAction, fontSize: '32px', fontStyle: 'bold' }).setOrigin(0.5)
    this.add([this.image, this.label])
  }
  setFocused(focused: boolean): this { super.setFocused(focused, uiTokens.stageFocusScale, 0.7); this.image.setAlpha(focused ? 1 : 0.7); return this }
}

export class HealthBar extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.Rectangle
  constructor(scene: Phaser.Scene, width: number, color: number, reverse = false) {
    super(scene, 0, 0)
    const x = reverse ? width : 0
    const originX = reverse ? 1 : 0
    this.add(scene.add.rectangle(x, 0, width, uiTokens.hud.healthHeight, uiTokens.colors.panel).setOrigin(originX, 0.5).setStrokeStyle(2, uiTokens.colors.lineBright))
    this.fill = scene.add.rectangle(x, 0, width - 8, uiTokens.hud.healthHeight - 8, color).setOrigin(originX, 0.5); this.add(this.fill)
    for (let mark = 1; mark < 4; mark += 1) this.add(scene.add.rectangle(reverse ? width - mark * width / 4 : mark * width / 4, 0, 2, uiTokens.hud.healthHeight - 8, uiTokens.colors.textPrimary, 0.14))
  }
  setRatio(ratio: number): this { this.fill.setScale(Math.max(0, Math.min(1, ratio)), 1); return this }
}

export class AnnouncerText extends Phaser.GameObjects.Text {
  constructor(scene: Phaser.Scene) { super(scene, 0, 0, '', typography.announcer); this.setOrigin(0.5).setStroke(typography.announcer.stroke, typography.announcer.strokeThickness) }
  showMessage(message: string): this { this.setText(message).setVisible(Boolean(message)); return this }
}

export const addFocalGlow = (scene: Phaser.Scene, parent: Phaser.GameObjects.Container, x: number, y: number, width: number, height: number, color: number, alpha: number = uiTokens.opacity.focusGlow): Phaser.GameObjects.Graphics => {
  const glow = scene.add.graphics().setPosition(x, y)
  ;[1, 0.76, 0.52, 0.28].forEach((scale, index) => glow.fillStyle(color, alpha * (0.16 + index * 0.12)).fillEllipse(0, 0, width * scale, height * scale))
  parent.add(glow)
  return glow
}

export const fighterSilhouette = (scene: Phaser.Scene, x: number, y: number, width: number, height: number, color: number, alpha = 0.38): Phaser.GameObjects.Graphics => {
  const silhouette = scene.add.graphics().setPosition(x, y)
  silhouette.fillStyle(color, alpha).fillEllipse(0, -height * 0.23, width * 0.31, height * 0.28)
  silhouette.fillStyle(color, alpha * 0.82).fillEllipse(0, height * 0.16, width * 0.92, height * 0.58)
  silhouette.fillStyle(color, alpha * 0.54).fillRoundedRect(-width * 0.29, height * 0.22, width * 0.58, height * 0.39, Math.min(16, width * 0.08))
  return silhouette
}

