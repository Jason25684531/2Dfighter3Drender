import Phaser from 'phaser'
import type { FighterSnapshot, CombatEvent } from '../../combat/CombatWorld'
import { sampleCharacterAnimationManifest, type FighterAnimationKey } from './FighterAnimationManifest'
import { facingScaleX, resolveFighterAnimation, resolvePreviewAnimation, type FighterAnimationResolution } from './FighterAnimationResolver'
import { uiTokens } from '../tokens/uiTokens'

export type FighterMediaStatus = 'PLACEHOLDER' | 'LOADING' | 'PLAYING' | 'ERROR'

export class FighterVideoRenderer extends Phaser.GameObjects.Container {
  private readonly placeholder: Phaser.GameObjects.Rectangle
  private video?: Phaser.GameObjects.Video
  private rawVideo?: HTMLVideoElement
  private current?: FighterAnimationResolution
  private destroyed = false
  private readonly manifest
  private mediaStatus: FighterMediaStatus = 'PLACEHOLDER'
  private metadataListener?: () => void
  private errorListener?: () => void
  private playingListener?: () => void

  constructor(scene: Phaser.Scene, manifest = sampleCharacterAnimationManifest, placeholderColor: number = uiTokens.colors.lineBright, private readonly onMediaStatus?: (status: FighterMediaStatus) => void) {
    super(scene, 0, 0); this.manifest = manifest
    this.placeholder = scene.add.rectangle(0, -225, 120, 450, placeholderColor, 0.86).setStrokeStyle(2, uiTokens.colors.focus, 0.32)
    this.add(this.placeholder)
  }

  update(fighter: FighterSnapshot, recentEvent?: CombatEvent, recentEventToken?: string): void {
    if (this.destroyed) return
    const resolved = resolveFighterAnimation({ ...fighter, recentEvent, recentEventToken }, this.manifest)
    const changed = !this.current || this.current.animationKey !== resolved.animationKey || this.current.restartToken !== resolved.restartToken
    this.current = resolved
    this.setPosition(fighter.x, fighter.y)
    this.setScale(facingScaleX(resolved.facing), 1)
    if (changed) this.switchAnimation(resolved)
  }

  getAnimationKey(): FighterAnimationKey | undefined { return this.current?.animationKey }
  hasVideo(): boolean { return Boolean(this.video?.visible) }
  getMediaStatus(): FighterMediaStatus { return this.mediaStatus }
  preview(animationKey: FighterAnimationKey, facing: 'LEFT' | 'RIGHT' = 'RIGHT', loopOverride?: boolean): void { const resolved = resolvePreviewAnimation(animationKey, this.manifest[animationKey], facing, loopOverride); this.current = resolved; this.setScale(facingScaleX(facing), 1); this.switchAnimation(resolved) }

  destroy(fromScene?: boolean): void {
    this.destroyed = true
    this.releaseVideo()
    super.destroy(fromScene)
  }

  private switchAnimation(resolved: FighterAnimationResolution): void {
    const entry = this.manifest[resolved.animationKey]
    if (!entry?.url) { this.showFallback(`missing:${resolved.animationKey}`); return }
    this.releaseVideo()
    try {
      const targetHeight = uiTokens.fighter.targetHeight * entry.scale
      const video = this.scene.add.video(entry.offsetX, -targetHeight / 2 + entry.offsetY)
      video.loadURL(entry.url, true)
      const rawVideo = (video as unknown as { video?: HTMLVideoElement }).video
      const fitVideo = (): void => {
        const width = rawVideo?.videoWidth ?? 0
        const height = rawVideo?.videoHeight ?? 0
        if (width > 0 && height > 0) video.setDisplaySize(targetHeight * width / height, targetHeight)
      }
      this.rawVideo = rawVideo
      this.metadataListener = fitVideo
      this.errorListener = () => this.showFallback(`decode:${entry.filename}`)
      this.playingListener = () => this.setMediaStatus('PLAYING')
      rawVideo?.addEventListener('loadedmetadata', fitVideo, { once: true })
      fitVideo()
      rawVideo?.addEventListener('error', this.errorListener, { once: true })
      rawVideo?.addEventListener('playing', this.playingListener, { once: true })
      this.video = video
      this.add(video)
      this.placeholder.setVisible(false)
      this.setMediaStatus('LOADING')
      video.play(resolved.loop)
    } catch {
      this.showFallback(`create:${entry.filename}`)
    }
  }

  private showFallback(reason: string): void {
    this.placeholder.setVisible(true)
    if (this.video) this.releaseVideo()
    this.setMediaStatus('ERROR')
    if (import.meta.env.DEV) console.warn(`[FighterVideoRenderer] ${reason}`)
  }

  private setMediaStatus(status: FighterMediaStatus): void { this.mediaStatus = status; this.onMediaStatus?.(status) }

  private releaseVideo(): void {
    if (!this.video) return
    const rawVideo = this.rawVideo
    if (this.metadataListener) rawVideo?.removeEventListener('loadedmetadata', this.metadataListener)
    if (this.errorListener) rawVideo?.removeEventListener('error', this.errorListener)
    if (this.playingListener) rawVideo?.removeEventListener('playing', this.playingListener)
    rawVideo?.pause()
    rawVideo?.removeAttribute('src')
    this.video.destroy()
    this.video = undefined
    this.rawVideo = undefined
    this.metadataListener = undefined
    this.errorListener = undefined
    this.playingListener = undefined
  }
}
