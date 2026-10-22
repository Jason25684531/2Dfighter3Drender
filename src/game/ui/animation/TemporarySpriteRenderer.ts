import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { fighterSilhouette } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { presentationSheet, resolvePresentation, spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureFrame, spriteTextureKey, type Presentation, type PresentationContext, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'
import { isSheetSprite } from './SheetSpriteManifest'
import { STAGE_TUNING } from '../../config/stageTuning'

// 2.5D 抬升／縮放比例在 config/stageTuning.ts 調整。
const { rise: DEPTH_RISE, shrink: DEPTH_SHRINK } = STAGE_TUNING.depth

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
  // y＝畫面上的身體位置（含縱深抬升），ground＝影子所在地面，scale＝縱深縮放。
  private previousPosition = { x: 0, y: 0, ground: 0, scale: 1 }
  private currentPosition = { x: 0, y: 0, ground: 0, scale: 1 }
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
    const rise = fighter.z * DEPTH_RISE, position = { x: fighter.x, y: fighter.y - rise, ground: this.floorY - rise, scale: 1 - fighter.z * DEPTH_SHRINK }
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
    const scale = lerp('scale')
    this.setPosition(lerp('x'), lerp('y')); this.setScale(this.direction * scale, scale)
    this.shadow.setY((lerp('ground') - this.y) / scale + 5)
  }
}
