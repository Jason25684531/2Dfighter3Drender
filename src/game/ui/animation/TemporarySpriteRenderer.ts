import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { uiTokens } from '../tokens/uiTokens'
import { presentationSheet, resolvePresentation, spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureFrame, spriteTextureKey, type Presentation, type PresentationContext, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'
import { isSheetSprite } from './SheetSpriteManifest'
import { crouchFrame, HEAD_PX, headPoint, peakFrame } from './SpriteHitTest'
import type { PlayerSlotId } from '../../input/InputManager'

/** 拍照頭像（圓形）的 texture key；只在該玩家拍了照時存在。 */
export const faceKey = (id: PlayerSlotId): string => `face-${id}`

export class TemporarySpriteRenderer extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Ellipse
  private readonly image?: Phaser.GameObjects.Image
  private readonly face?: Phaser.GameObjects.Image
  private action?: SpriteAction
  private fighterState?: FighterSnapshot['state']
  /** 目前播放的呈現語意（sheet 角色）；攻擊期間鎖定。 */
  presentation?: Presentation
  private actionStartTick = 0
  private attackId = 0
  private lastTick?: number
  private previousPosition = { x: 0, y: 0 }
  private currentPosition = { x: 0, y: 0 }
  private direction = 1

  constructor(scene: Phaser.Scene, readonly spriteId: SpriteId | undefined, private readonly floorY: number, face?: string) {
    super(scene, 0, 0)
    this.shadow = scene.add.ellipse(0, 5, 280, 42, uiTokens.colors.shadow, 0.48)
    this.add(this.shadow)
    if (spriteId && scene.textures.exists(spriteTextureKey(spriteId, 'idle'))) {
      const key = spriteTextureKey(spriteId, 'idle')
      this.image = scene.add.image(0, 0, key, spriteTextureFrame(spriteId)).setOrigin(0.5, spriteOriginY(spriteId))
      this.image.setScale(spriteDisplayHeight(spriteId) / this.image.height)
      this.add(this.image)
      if (face && scene.textures.exists(face)) { this.face = scene.add.image(0, 0, face); this.add(this.face); this.placeFace() }
    }
  }

  update(fighter: FighterSnapshot, tick: number, context?: PresentationContext): void {
    const position = { x: fighter.x, y: fighter.y }
    this.previousPosition = tick === (this.lastTick ?? -2) + 1 ? this.currentPosition : position
    this.currentPosition = position; this.lastTick = tick; this.direction = fighter.facing === 'LEFT' ? -1 : 1
    this.renderAt(1)
    if (!this.image || !this.spriteId) return
    // 起身無敵：每 2 tick 明暗交替；tick 驅動，暫停時一起停。
    this.image.setAlpha(fighter.invulnerableTicks > 0 && (tick >> 1) % 2 ? 0.35 : 1)
    const action = spriteActionFor(fighter, context)
    // 招式在新 attackId 出現時鎖定，攻擊中途不因放開蹲鍵等而換圖。
    const presentation = !isSheetSprite(this.spriteId) ? undefined : action === 'attack' && fighter.attackId === this.attackId && this.action === 'attack' ? this.presentation : resolvePresentation(fighter, context)
    if (action !== this.action || presentation !== this.presentation || fighter.state !== this.fighterState || (action === 'attack' && fighter.attackId !== this.attackId) || tick < this.actionStartTick) {
      this.action = action; this.fighterState = fighter.state; this.presentation = presentation; this.actionStartTick = tick; this.attackId = fighter.attackId
    }
    const sheet = presentation && presentationSheet[presentation]
    const frame = spriteFrameFor(fighter, action, tick - this.actionStartTick, this.spriteId, this.peak(action, sheet))
    const key = sheet ? `${this.spriteId}-${sheet}` : spriteTextureKey(this.spriteId, action, frame), textureFrame = spriteTextureFrame(this.spriteId, frame)
    if (this.scene.textures.exists(key) && (this.image.texture.key !== key || (textureFrame !== undefined && String(this.image.frame.name) !== String(textureFrame)))) this.image.setTexture(key, textureFrame).setScale(spriteDisplayHeight(this.spriteId) / this.image.height)
    this.placeFace()
  }

  /** 頭像跟著目前影格的頭部（影格像素 → container 座標）。 */
  private placeFace(): void {
    const { face, image } = this
    if (!face || !image) return
    const head = headPoint(this.scene, image.texture.key, image.frame.name), scale = image.scaleY
    face.setVisible(Boolean(head)).setAlpha(image.alpha)
    if (head) face.setPosition((head.x - image.frame.width / 2) * scale, (head.y - image.originY * image.frame.height) * scale).setDisplaySize(HEAD_PX * scale, HEAD_PX * scale)
  }

  private peak(action: SpriteAction, sheet?: string): number | undefined {
    if (!sheet) return undefined
    const key = `${this.spriteId}-${sheet}`
    return action === 'attack' ? peakFrame(this.scene, key) : action === 'guard' ? crouchFrame(this.scene, key) : undefined
  }

  /** 命中判定用：攻擊中依 snapshot 算當下影格（與 update 同規則，招式鎖定），其餘用目前顯示的影格。 */
  pose(fighter: FighterSnapshot, context?: PresentationContext): { key: string; frame: string | number; scale: number; originY: number } | undefined {
    const { image, spriteId: id } = this
    if (!image || !id) return undefined
    const scale = spriteDisplayHeight(id) / image.height, originY = spriteOriginY(id)
    if (spriteActionFor(fighter, context) !== 'attack') return { key: image.texture.key, frame: image.frame.name, scale, originY }
    const presentation = !isSheetSprite(id) ? undefined : fighter.attackId === this.attackId && this.action === 'attack' ? this.presentation : resolvePresentation(fighter, context)
    const sheet = presentation && presentationSheet[presentation], frame = spriteFrameFor(fighter, 'attack', 0, id, this.peak('attack', sheet))
    return { key: sheet ? `${id}-${sheet}` : spriteTextureKey(id, 'attack', frame), frame: spriteTextureFrame(id, frame) ?? image.frame.name, scale, originY }
  }

  renderAt(alpha: number): void {
    const lerp = (key: keyof typeof this.currentPosition): number => this.previousPosition[key] + (this.currentPosition[key] - this.previousPosition[key]) * alpha
    this.setPosition(lerp('x'), lerp('y')); this.setScale(this.direction, 1)
    this.shadow.setY(this.floorY - this.y + 5)
  }
  /** 受擊閃白：整隻染白 ms 毫秒。 */
  flash(ms = 60): void {
    const parts = [this.image, this.face].filter((part): part is Phaser.GameObjects.Image => Boolean(part))
    parts.forEach((part) => part.setTintFill(0xffffff))
    this.scene.time.delayedCall(ms, () => parts.forEach((part) => part.active && part.clearTint()))
  }
}
