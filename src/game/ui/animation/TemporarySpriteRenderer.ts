import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { fighterSilhouette } from '../VisualComponents'
import { uiTokens } from '../tokens/uiTokens'
import { spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureKey, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'

export class TemporarySpriteRenderer extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly image?: Phaser.GameObjects.Image
  private readonly fallback?: Phaser.GameObjects.Graphics
  private action?: SpriteAction
  private actionStartTick = 0
  private attackId = 0
  private lastTick?: number
  private previousPosition = { x: 0, y: 0 }
  private currentPosition = { x: 0, y: 0 }

  constructor(scene: Phaser.Scene, private readonly spriteId: SpriteId | undefined, fallbackColor: number, private readonly floorY: number) {
    super(scene, 0, 0)
    this.shadow = scene.add.ellipse(0, 5, 280, 42, uiTokens.colors.shadow, 0.48)
    this.add(this.shadow)
    if (spriteId && scene.textures.exists(spriteTextureKey(spriteId, 'idle'))) {
      const key = spriteTextureKey(spriteId, 'idle')
      this.image = scene.add.image(0, 0, key).setOrigin(0.5, spriteOriginY(spriteId))
      this.image.setScale(spriteDisplayHeight(spriteId) / this.image.height)
      this.add(this.image)
    } else {
      this.fallback = fighterSilhouette(scene, 0, -215, 200, 430, fallbackColor, 0.52)
      this.add(this.fallback)
    }
  }

  update(fighter: FighterSnapshot, tick: number): void {
    this.previousPosition = tick === (this.lastTick ?? -2) + 1 ? this.currentPosition : { x: fighter.x, y: fighter.y }
    this.currentPosition = { x: fighter.x, y: fighter.y }; this.lastTick = tick
    this.renderAt(1)
    this.setScale(fighter.facing === 'LEFT' ? -1 : 1, 1)
    if (!this.image || !this.spriteId) return
    const action = spriteActionFor(fighter)
    if (action !== this.action || (action === 'attack' && fighter.attackId !== this.attackId) || tick < this.actionStartTick) {
      this.action = action; this.actionStartTick = tick; this.attackId = fighter.attackId
    }
    const key = spriteTextureKey(this.spriteId, action, spriteFrameFor(fighter, action, tick - this.actionStartTick))
    if (this.scene.textures.exists(key) && this.image.texture.key !== key) this.image.setTexture(key).setScale(spriteDisplayHeight(this.spriteId) / this.image.height)
  }

  renderAt(alpha: number): void {
    this.setPosition(this.previousPosition.x + (this.currentPosition.x - this.previousPosition.x) * alpha, this.previousPosition.y + (this.currentPosition.y - this.previousPosition.y) * alpha)
    this.shadow.setY(this.floorY - this.y + 5)
  }
}
