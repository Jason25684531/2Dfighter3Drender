import Phaser from 'phaser'
import type { FighterSnapshot } from '../../combat/CombatWorld'
import { lungeFor } from '../../config/hitTuning'
import { uiTokens } from '../tokens/uiTokens'
import { presentationSheetFor, resolvePresentation, spriteActionFor, spriteDisplayHeight, spriteFrameFor, spriteOriginY, spriteTextureFrame, spriteTextureKey, type Presentation, type PresentationContext, type SpriteAction, type SpriteId } from './TemporarySpriteManifest'
import { alignedSprites, isSheetSprite } from './SheetSpriteManifest'
import { crouchFrame, groundOrigin, idleScale, peakFrame } from './SpriteHitTest'


/** 起身無敵：固定半透明，不閃爍。 */
const INVULNERABLE_ALPHA = 0.6
export type SpritePose = { key: string; frame: string | number; scale: number; originY: number }

export class TemporarySpriteRenderer extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Ellipse
  private image?: Phaser.GameObjects.Image
  private action?: SpriteAction
  private fighterState?: FighterSnapshot['state']
  /** 目前播放的呈現語意（sheet 角色）；攻擊期間鎖定。 */
  presentation?: Presentation
  private actionStartTick = 0
  private shownFrame = 0
  /** 受擊→倒地共用 prone 圖集；倒地動畫接著目前影格往下播，不從第 0 格重來。 */
  private frameFloor = 0
  private attackId = 0
  private lastTick?: number
  private previousPosition = { x: 0, y: 0, lift: 0 }
  private currentPosition = { x: 0, y: 0, lift: 0 }
  private direction = 1

  constructor(scene: Phaser.Scene, public spriteId: SpriteId | undefined, private readonly floorY: number) {
    super(scene, 0, 0)
    this.shadow = scene.add.ellipse(0, 5, 280, 42, uiTokens.colors.shadow, 0.48)
    this.add(this.shadow)
    this.ensureImage()
  }

  private ensureImage(): void {
    const { scene, spriteId } = this
    if (!this.image && spriteId) {
      const key = this.textureKey(spriteId, 'idle')
      if (!scene.textures.exists(key)) return
      this.image = scene.add.image(0, 0, key, spriteTextureFrame(spriteId)).setOrigin(0.5, spriteOriginY(spriteId))
      this.image.setScale(spriteDisplayHeight(spriteId) / this.image.height)
      this.add(this.image)
    }
  }

  private textureKey(id: SpriteId, action: SpriteAction, frame = 0, sheet?: string): string {
    const key = sheet ? `${id}-${sheet}` : spriteTextureKey(id, action, frame)
    return id in alignedSprites && this.scene.textures.exists(`hd-${key}`) ? `hd-${key}` : key
  }

  update(fighter: FighterSnapshot, tick: number, context?: PresentationContext): void {
    const action = spriteActionFor(fighter, context)
    const progress = action === 'attack' ? fighter.lungeProgress : undefined, hop = lungeFor(this.spriteId)?.[fighter.attack]?.hop ?? 0
    const lift = progress === undefined || progress === 1 || !fighter.grounded ? 0 :Math.sin(Math.PI * progress) * hop
    const position = { x: fighter.x, y: fighter.y, lift }
    this.previousPosition = tick === (this.lastTick ?? -2) + 1 ? this.currentPosition : position
    this.currentPosition = position; this.lastTick = tick; this.direction = fighter.facing === 'LEFT' ? -1 : 1
    this.ensureImage()
    this.renderAt(1)
    if (!this.image || !this.spriteId) return
    this.image.setAlpha(fighter.invulnerableTicks > 0 ? INVULNERABLE_ALPHA : 1)
    // 招式在新 attackId 出現時鎖定，攻擊中途不因放開蹲鍵等而換圖。
    const presentation = !isSheetSprite(this.spriteId) ? undefined : action === 'attack' && fighter.attackId === this.attackId && this.action === 'attack' ? this.presentation : resolvePresentation(fighter, context)
    if (action !== this.action || presentation !== this.presentation || fighter.state !== this.fighterState || (action === 'attack' && fighter.attackId !== this.attackId) || tick < this.actionStartTick) {
      this.frameFloor = presentation === 'PRONE' && this.presentation === 'PRONE' ? this.shownFrame : 0
      this.action = action; this.fighterState = fighter.state; this.presentation = presentation; this.actionStartTick = tick; this.attackId = fighter.attackId
    }
    const sheet = presentation && presentationSheetFor(this.spriteId, presentation)
    const frame = this.shownFrame = Math.max(this.frameFloor, spriteFrameFor(fighter, action, tick - this.actionStartTick, this.spriteId, this.peak(action, sheet), sheet))
    const key = this.textureKey(this.spriteId, action, frame, sheet)
    const textureFrame = spriteTextureFrame(this.spriteId, frame)
    if (this.scene.textures.exists(key) && (this.image.texture.key !== key || (textureFrame !== undefined && String(this.image.frame.name) !== String(textureFrame)))) {
      this.image.setTexture(key, textureFrame)
      this.image.setScale(spriteDisplayHeight(this.spriteId) / this.image.height * (sheet === 'idle' ? idleScale(this.image.frame) : 1))
    }
    this.image.setOrigin(0.5, this.originFor(this.image.frame, fighter.grounded && progress === undefined))
  }

  private originFor(frame: Phaser.Textures.Frame, grounded: boolean): number {
    const fallback = spriteOriginY(this.spriteId!)
    if (grounded) return groundOrigin(frame, fallback)
    const idle = this.scene.textures.getFrame(this.textureKey(this.spriteId!, 'idle'), spriteTextureFrame(this.spriteId))
    return idle ? groundOrigin(idle, fallback) : fallback
  }

  private peak(action: SpriteAction, sheet?: string): number | undefined {
    if (!sheet) return undefined
    // The compact and full-size sheets share the same frame indices.
    const key = `${this.spriteId}-${sheet}`
    return action === 'attack' ? peakFrame(this.scene, key) : action === 'guard' && sheet === 'crouch' ? crouchFrame(this.scene, key) : undefined
  }

  /** 命中判定用：攻擊中依 snapshot 算當下影格（與 update 同規則，招式鎖定），其餘用目前顯示的影格。 */
  pose(fighter: FighterSnapshot, context?: PresentationContext): SpritePose | undefined {
    const { image, spriteId: id } = this
    if (!image || !id) return undefined
    if (spriteActionFor(fighter, context) !== 'attack') return { key: image.texture.key, frame: image.frame.name, scale: spriteDisplayHeight(id) / image.height * (this.presentation === 'IDLE' ? idleScale(image.frame) : 1), originY: this.originFor(image.frame, fighter.grounded) }
    const presentation = !isSheetSprite(id) ? undefined : fighter.attackId === this.attackId && this.action === 'attack' ? this.presentation : resolvePresentation(fighter, context)
    const sheet = presentation && presentationSheetFor(this.spriteId, presentation), frame = spriteFrameFor(fighter, 'attack', 0, id, this.peak('attack', sheet), sheet)
    const key = this.textureKey(id, 'attack', frame, sheet), name = spriteTextureFrame(id, frame) ?? image.frame.name
    const textureFrame = this.scene.textures.getFrame(key, name)
    return { key, frame: name, scale: spriteDisplayHeight(id) / (textureFrame?.height ?? image.height), originY: this.originFor(textureFrame ?? image.frame, fighter.grounded && fighter.lungeProgress === undefined) }
  }

  idlePose(): SpritePose | undefined {
    const id = this.spriteId
    if (!id) return undefined
    const key = this.textureKey(id, 'idle')
    if (!this.scene.textures.exists(key)) return undefined
    const frame = this.scene.textures.getFrame(key, spriteTextureFrame(id))
    return { key, frame: frame.name, scale: spriteDisplayHeight(id) / frame.height, originY: groundOrigin(frame, spriteOriginY(id)) }
  }

  renderAt(alpha: number): void {
    const lerp = (key: keyof typeof this.currentPosition): number => this.previousPosition[key] + (this.currentPosition[key] - this.previousPosition[key]) * alpha
    this.setPosition(lerp('x'), lerp('y')); this.setScale(this.direction, 1)
    this.image?.setY(-lerp('lift'))
    this.shadow.setY(this.floorY - this.y + 5)
  }
  /** 受擊閃白：整隻染白 ms 毫秒。 */
  flash(ms = 60): void {
    const image = this.image
    image?.setTintFill(uiTokens.colors.focus)
    this.scene.time.delayedCall(ms, () => { if (image?.active) image.clearTint() })
  }
}
