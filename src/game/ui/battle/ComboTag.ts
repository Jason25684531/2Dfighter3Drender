import Phaser from 'phaser'
import { comboCallout } from '../ViewModels'
import { colorHex, reducedMotion, uiTokens } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { stopOwnedTweens } from '../tweens'

export type ComboSide = 'left' | 'right'

/** 街頭塗鴉風格的連擊標語：噴漆潑濺色塊＋N HITS＋塗鴉等級字。之後換成圖片字只改這個檔案。 */
export class ComboTag extends Phaser.GameObjects.Container {
  private readonly splat: Phaser.GameObjects.Graphics
  private readonly hitCount: Phaser.GameObjects.Text
  private readonly word: Phaser.GameObjects.Text
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private hits = 0
  private side: ComboSide = 'left'

  constructor(scene: Phaser.Scene, private readonly color: number) {
    super(scene, 0, 600)
    this.splat = scene.add.graphics()
    this.hitCount = scene.add.text(0, -48, '', { ...typography.combo, color: colorHex('textPrimary'), stroke: colorHex('background0'), strokeThickness: 8 })
    this.word = scene.add.text(0, 24, '', { fontFamily: uiTokens.fonts.graffiti, fontSize: uiTokens.hud.combo, stroke: colorHex('background0'), strokeThickness: 10, padding: { x: 16, y: 10 } }).setShadow(6, 6, '#000000', 0, true, true)
    this.add([this.splat, this.hitCount, this.word]).setVisible(false)
  }

  /** side 只在標語從隱藏變成顯示時套用，連擊途中不換邊。 */
  set(hits: number, side: ComboSide): void {
    if (hits === this.hits) return
    const callout = comboCallout(hits), shown = comboCallout(this.hits) !== undefined, rising = hits > this.hits
    this.hits = hits
    stopOwnedTweens(this.tweens)
    if (!callout) {
      if (reducedMotion || !shown) { this.setVisible(false); return }
      this.tweens.push(this.scene.tweens.add({ targets: this, alpha: 0, duration: 240, onComplete: () => this.setVisible(false) }))
      return
    }
    const tierUp = callout.word !== this.word.text
    this.hitCount.setText(callout.count); this.word.setText(callout.word).setColor(colorHex(callout.color))
    if (!shown) {
      this.side = side
      const left = side === 'left'
      this.setX(left ? 60 : 1860).setRotation((left ? -1 : 1) * Phaser.Math.DegToRad(Phaser.Math.FloatBetween(3, 8)))
      ;[this.hitCount, this.word].forEach((text) => text.setOrigin(left ? 0 : 1, 0.5))
    }
    if (!shown || tierUp) this.paint()
    this.setAlpha(1).setScale(1).setVisible(true)
    if (rising && !reducedMotion) this.tweens.push(this.scene.tweens.add({ targets: this, scale: { from: 1.6, to: 1 }, duration: 140, ease: 'Back.Out' }))
  }

  // ponytail: 程式畫的潑濺（主橢圓＋飛濺點＋滴痕）；有正式塗鴉素材時換成圖片。
  private paint(): void {
    const width = Math.max(this.word.width, this.hitCount.width), cx = (this.side === 'left' ? 1 : -1) * width / 2, g = this.splat.clear().fillStyle(this.color, 0.85)
    g.fillEllipse(cx, 0, width * 1.15, 190)
    for (let i = 0; i < 7; i += 1) { const a = Math.random() * Math.PI * 2; g.fillCircle(cx + Math.cos(a) * width * 0.62, Math.sin(a) * 105, Phaser.Math.Between(10, 28)) }
    for (let i = 0; i < 3; i += 1) { const x = cx + (Math.random() - 0.5) * width * 0.8, h = Phaser.Math.Between(40, 110); g.fillRect(x - 5, 60, 10, h).fillCircle(x, 60 + h, 8) }
  }

  destroy(fromScene?: boolean): void { stopOwnedTweens(this.tweens); super.destroy(fromScene) }
}
