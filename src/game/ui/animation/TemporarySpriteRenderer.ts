import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { fighterSilhouette } from '../VisualComponents'
import { spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureKey, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'

export class TemporarySpriteRenderer extends Phaser.GameObjects.Container {
  private readonly image?: Phaser.GameObjects.Image
  private readonly fallback?: Phaser.GameObjects.Graphics
  private action?: SpriteAction
  private actionStartTick = 0
  private attackId = 0

  constructor(scene: Phaser.Scene, private readonly spriteId: SpriteId | undefined, fallbackColor: number) {
    super(scene, 0, 0)
    if (spriteId && scene.textures.exists(spriteTextureKey(spriteId, 'idle'))) {
      const key = spriteTextureKey(spriteId, 'idle')
      this.image = scene.add.image(0, 0, key).setOrigin(0.5, spriteOriginY(spriteId))
      const texture = scene.textures.get(key).getSourceImage() as HTMLImageElement
      const height = spriteDisplayHeight(spriteId)
      this.image.setDisplaySize(height * texture.width / texture.height, height)
      this.add(this.image)
    } else {
      this.fallback = fighterSilhouette(scene, 0, -215, 200, 430, fallbackColor, 0.52)
      this.add(this.fallback)
    }
  }

  update(fighter: FighterSnapshot, tick: number): void {
    this.setPosition(fighter.x, fighter.y)
    this.setScale(fighter.facing === 'LEFT' ? -1 : 1, 1)
    if (!this.image || !this.spriteId) return
    const action = spriteActionFor(fighter)
    if (action !== this.action || (action === 'attack' && fighter.attackId !== this.attackId) || tick < this.actionStartTick) {
      this.action = action; this.actionStartTick = tick; this.attackId = fighter.attackId
    }
    const key = spriteTextureKey(this.spriteId, action, spriteFrameFor(fighter, action, tick - this.actionStartTick))
    if (this.scene.textures.exists(key) && this.image.texture.key !== key) this.image.setTexture(key)
  }
}
