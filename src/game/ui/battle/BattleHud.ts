import Phaser from 'phaser'
import layout from '../assets/hudLayout.json'
import type { SpriteId } from '../animation/TemporarySpriteManifest'
import { headKey } from '../p1/headCrop'
import { healthCrop, healthPercent, healthRatio, remainingLives } from '../presentationMath'
import { hudDisplay, hudLabel } from '../tokens/typography'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { stopOwnedTweens } from '../tweens'
import type { BattleViewModel } from '../ViewModels'

type Side = 'p1' | 'p2'
type SideState = {
  fill: Phaser.GameObjects.Image
  trail: Phaser.GameObjects.Image
  percent: Phaser.GameObjects.Text
  lives: Phaser.GameObjects.Image[]
  ratio: number
  trailRatio: number
  chase?: Phaser.Tweens.Tween
  warning?: Phaser.Tweens.Tween
}

export class BattleHud extends Phaser.GameObjects.Container {
  private readonly sides: Record<Side, SideState>
  private readonly timer: Phaser.GameObjects.Text
  private readonly portraitMasks: { source: Phaser.GameObjects.Image; mask: Phaser.Display.Masks.BitmapMask }[] = []
  private readonly canvasMasks: string[] = []
  private readonly pendingPortraits: Partial<Record<Side, SpriteId>>
  private pulse?: Phaser.Tweens.Tween
  private seconds?: number

  constructor(scene: Phaser.Scene, player: { sprite?: SpriteId; name: string }, enemy: { sprite?: SpriteId; name: string }) {
    super(scene, 0, 0)
    const art = (key: keyof typeof layout.hud) => {
      const { x, y } = layout.hud[key]
      const image = scene.add.image(x, y, key).setOrigin(0)
      this.add(image)
      return image
    }
    const text = (key: keyof typeof layout.hudText, value: string, options: Phaser.Types.GameObjects.Text.TextStyle = {}) => {
      const { x, y, size, color, font } = layout.hudText[key]
      const item = scene.add.text(x, y, value, { ...(font.startsWith('ROG') ? hudDisplay : hudLabel), fontSize: size, color, ...options }).setOrigin(0, 0.85)
      this.add(item)
      return item
    }
    art('hud-under')
    this.pendingPortraits = { p1: player.sprite, p2: enemy.sprite }
    this.refreshPortraits()
    const health = (side: Side) => {
      const key = `health-${side}` as const, trail = art(key)
      if (scene.game.renderer.type === Phaser.WEBGL) trail.setTintFill(uiTokens.colors.focus)
      else trail.setTexture(this.canvasMask(key, (context, w, h) => {
        context.fillStyle = colorHex('focus')
        context.fillRect(0, 0, w, h)
      }))
      return { trail, fill: art(key), lives: [art(`life-${side}-1`), art(`life-${side}-2`)] }
    }
    const p1 = health('p1'), p2 = health('p2')
    art('hud-over')
    this.sides = {
      p1: { ...p1, percent: text('percent-p1', '', { stroke: colorHex('focus'), strokeThickness: 1 }), ratio: 1, trailRatio: 1 },
      p2: { ...p2, percent: text('percent-p2', '', { stroke: colorHex('focus'), strokeThickness: 1 }), ratio: 1, trailRatio: 1 },
    }
    text('label-p1', 'HP _ CORE // P1', { stroke: colorHex('focus'), strokeThickness: 0.6 })
    text('label-p2', 'P2 // HP _ CORE', { stroke: colorHex('focus'), strokeThickness: 0.6 })
    text('tag-p1', 'P1')
    text('tag-p2', 'P2')
    const p1Name = text('name-p1', player.name).setX(layout.hudText['name-p1'].x + 8)
    const p2Name = text('name-p2', enemy.name).setX(layout.hudText['tag-p2'].x - 10).setOrigin(1, 0.85)
    for (const name of [p1Name, p2Name]) name.setScale(Math.min(1, 208 / Math.max(1, name.width)), 1)
    const clock = layout.hud['hud-under']
    this.timer = text('timer', '99').setX(clock.x + clock.w / 2).setOrigin(0.5, 0.85)
  }

  private refreshPortraits(): void {
    this.portrait('p1')
    this.portrait('p2')
  }

  private portrait(side: Side): void {
    const sprite = this.pendingPortraits[side]
    if (!sprite) return
    const key = headKey(sprite.replace(/^hd-/, ''))
    if (!this.scene.textures.exists(key)) return
    const maskKey = `portrait-${side}` as const
    const index = side === 'p2' && this.list[1]?.name === 'portrait-p1' ? 2 : 1
    const { x, y, w, h } = layout.hud[maskKey]
    const size = h * 1.6
    if (this.scene.game.renderer.type === Phaser.WEBGL) {
      const source = this.scene.make.image({ x, y, key: maskKey }, false).setOrigin(0)
      const mask = source.createBitmapMask()
      this.portraitMasks.push({ source, mask })
      this.addAt(this.scene.add.image(x + w / 2, y + h / 2, key).setName(maskKey).setDisplaySize(size, size).setMask(mask), index)
    } else {
      const texture = this.canvasMask(maskKey, context => {
        context.drawImage(this.scene.textures.get(key).getSourceImage() as CanvasImageSource, (w - size) / 2, (h - size) / 2, size, size)
      })
      this.addAt(this.scene.add.image(x, y, texture).setName(maskKey).setOrigin(0), index)
    }
    delete this.pendingPortraits[side]
  }

  private canvasMask(key: keyof typeof layout.hud, paint: (context: CanvasRenderingContext2D, w: number, h: number) => void): string {
    const { w, h } = layout.hud[key], name = `hud-canvas-${key}`
    const texture = this.scene.textures.createCanvas(name, w, h)
    if (!texture) return name
    const context = texture.getContext()
    context.drawImage(this.scene.textures.get(key).getSourceImage() as CanvasImageSource, 0, 0)
    context.globalCompositeOperation = 'source-in'
    paint(context, w, h)
    texture.refresh()
    this.canvasMasks.push(name)
    return name
  }

  update(vm: BattleViewModel): void {
    this.refreshPortraits()
    this.health('p1', vm.playerHp / vm.maxHp, vm.enemyWins)
    this.health('p2', vm.enemyHp / vm.maxHp, vm.playerWins)
    if (this.seconds === vm.timerSeconds) return
    this.seconds = vm.timerSeconds
    const urgent = this.seconds <= 10
    this.timer.setText(String(this.seconds).padStart(2, '0')).setColor(colorHex(urgent ? 'danger' : 'textPrimary')).setScale(1)
    if (this.pulse) stopOwnedTweens([this.pulse])
    if (urgent && !reducedMotion) this.pulse = this.scene.tweens.add({ targets: this.timer, scale: 1.12, duration: 150, yoyo: true })
  }

  private health(side: Side, value: number, opponentWins: number): void {
    const state = this.sides[side]
    state.lives.forEach((life, index) => life.setVisible(index < remainingLives(opponentWins)))
    state.percent.setText(healthPercent(value))
    const ratio = healthRatio(value)
    if (ratio === state.ratio) return
    const low = ratio > 0 && ratio <= 0.25
    state.percent.setColor(low ? colorHex('danger') : layout.hudText[`percent-${side}`].color)
    if (low && !reducedMotion && !state.warning) {
      state.warning = this.scene.tweens.add({ targets: state.fill, alpha: 0.35, duration: 300, yoyo: true, repeat: -1 })
    } else if (!low && state.warning) {
      state.warning.stop()
      state.warning = undefined
      state.fill.setAlpha(1)
    }
    const crop = (image: Phaser.GameObjects.Image, amount: number) => {
      const { x, width } = healthCrop(amount, image.width, side === 'p2')
      image.setVisible(width > 0).setCrop(x, 0, width, image.height)
    }
    if (state.chase) stopOwnedTweens([state.chase])
    crop(state.fill, ratio)
    if (ratio > state.ratio || reducedMotion) {
      state.trailRatio = ratio
      crop(state.trail, ratio)
    } else {
      state.chase = this.scene.tweens.add({
        targets: state, trailRatio: ratio, delay: 180, duration: 600,
        onUpdate: () => crop(state.trail, state.trailRatio),
      })
    }
    state.ratio = ratio
  }

  destroy(fromScene?: boolean): void {
    if (!this.scene) return
    const textures = this.scene.textures
    for (const tween of [this.pulse, ...Object.values(this.sides).flatMap(({ chase, warning }) => [chase, warning])]) if (tween) stopOwnedTweens([tween])
    super.destroy(fromScene)
    for (const { source, mask } of this.portraitMasks) { mask.destroy(); source.destroy() }
    for (const key of this.canvasMasks) textures.remove(key)
  }
}
