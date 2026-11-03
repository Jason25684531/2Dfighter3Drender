import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { fighterSilhouette } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { presentationSheet, resolvePresentation, spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureFrame, spriteTextureKey, type Presentation, type PresentationContext, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'
import { isSheetSprite } from './SheetSpriteManifest'

export class TemporarySpriteRenderer extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly image?: Phaser.GameObjects.Image
  private readonly fallback?: Phaser.GameObjects.Graphics
  private action?: SpriteAction
  /** 目前播放的呈現語意（sheet 角色）；攻擊期間鎖定。 */
  presentation?: Presentation
  private actionStartTick = 0
  private attackId = 0
  private lastTick?: number
  private previousPosition = { x: 0, y: 0 }
  private currentPosition = { x: 0, y: 0 }
  private direction = 1

  constructor(scene: Phaser.Scene, private readonly spriteId: SpriteId | undefined, fallbackColor: number, private readonly floorY: number) {
    super(scene, 0, 0)
    this.shadow = scene.add.ellipse(0, 5, 280, 42, uiTokens.colors.shadow, 0.48)
    this.add(this.shadow)
    if (spriteId && scene.textures.exists(spriteTextureKey(spriteId, 'idle'))) {
      const key = spriteTextureKey(spriteId, 'idle')
      this.image = scene.add.image(0, 0, key, spriteTextureFrame(spriteId)).setOrigin(0.5, spriteOriginY(spriteId))
      this.image.setScale(spriteDisplayHeight(spriteId) / this.image.height)
      this.add(this.image)
    } else {
      this.fallback = fighterSilhouette(scene, 0, -215, 200, 430, fallbackColor, 0.52)
      this.add(this.fallback)
    }
  }

  update(fighter: FighterSnapshot, tick: number, context?: PresentationContext): void {
    const position = { x: fighter.x, y: fighter.y }
    this.previousPosition = tick === (this.lastTick ?? -2) + 1 ? this.currentPosition : position
    this.currentPosition = position; this.lastTick = tick; this.direction = fighter.facing === 'LEFT' ? -1 : 1
    this.renderAt(1)
    if (!this.image || !this.spriteId) return
    const action = spriteActionFor(fighter)
    // 招式在新 attackId 出現時鎖定，攻擊中途不因放開蹲鍵等而換圖。
    const presentation = !isSheetSprite(this.spriteId) ? undefined : action === 'attack' && fighter.attackId === this.attackId && this.action === 'attack' ? this.presentation : resolvePresentation(fighter, context)
    if (action !== this.action || presentation !== this.presentation || (action === 'attack' && fighter.attackId !== this.attackId) || tick < this.actionStartTick) {
      this.action = action; this.presentation = presentation; this.actionStartTick = tick; this.attackId = fighter.attackId
    }
    const sheet = presentation && presentationSheet[presentation]
    const frame = spriteFrameFor(fighter, action, tick - this.actionStartTick, this.spriteId)
    const key = sheet ? `${this.spriteId}-${sheet}` : spriteTextureKey(this.spriteId, action, frame), textureFrame = spriteTextureFrame(this.spriteId, frame)
    if (this.scene.textures.exists(key) && (this.image.texture.key !== key || (textureFrame !== undefined && String(this.image.frame.name) !== String(textureFrame)))) this.image.setTexture(key, textureFrame).setScale(spriteDisplayHeight(this.spriteId) / this.image.height)
  }

  renderAt(alpha: number): void {
    const lerp = (key: keyof typeof this.currentPosition): number => this.previousPosition[key] + (this.currentPosition[key] - this.previousPosition[key]) * alpha
    this.setPosition(lerp('x'), lerp('y')); this.setScale(this.direction, 1)
    this.shadow.setY(this.floorY - this.y + 5)
  }
}
