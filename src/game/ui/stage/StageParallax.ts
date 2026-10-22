import Phaser from 'phaser'
import { stageTextureKey, type StageId } from '../assets/TestAssetManifest'
import { MAX_SCROLL, STAGE_TUNING } from '../../config/stageTuning'

const { parallax } = STAGE_TUNING
/** 某層在鏡頭上限時仍不露邊所需的寬度（畫面像素）。 */
const coverWidth = (factor: number): number => 1920 + 2 * factor * MAX_SCROLL + 8

export const LAB_STAGE_DIR = '/test-assets/stages/laboratory'

/** 背景／影片／中景放進 back，地板前景放進 front；呼叫端決定兩者與角色、HUD 的順序。 */
export class StageParallax {
  private readonly background: Phaser.GameObjects.Image
  private readonly middle: Phaser.GameObjects.Graphics
  private readonly foreground?: Phaser.GameObjects.Image
  readonly video?: Phaser.GameObjects.Video
  private staticMode: boolean
  private paused = false
  constructor(scene: Phaser.Scene, stage: StageId, private readonly reduced: boolean, back: Phaser.GameObjects.Container, front: Phaser.GameObjects.Container) {
    this.staticMode = reduced
    this.background = scene.add.image(960, 540, stage === 'laboratory' && scene.textures.exists('lab-poster') ? 'lab-poster' : stageTextureKey(stage))
    // 等比 cover：寬度至少能涵蓋背景層在鏡頭上限時的位移。
    this.background.setScale(Math.max(coverWidth(parallax.background) / this.background.width, 1080 / this.background.height))
    back.add(this.background)
    if (stage === 'laboratory') {
      this.video = scene.add.video(960, 540).setVisible(false)
      this.video.on('play', () => { this.video?.setDisplaySize(this.background.displayWidth, this.background.displayHeight).setVisible(!this.staticMode && !this.paused) })
      this.video.on('error', () => this.video?.setVisible(false))
      this.video.loadURL(`${LAB_STAGE_DIR}/bg.mp4`, true)
      this.video.setMute(true)
      if (!reduced) this.video.play(true)
      back.add(this.video)
      // 前景底部對齊、等比放大到足以涵蓋自己的位移。
      if (scene.textures.exists('lab-foreground')) { this.foreground = scene.add.image(960, 1080, 'lab-foreground').setOrigin(0.5, 1); this.foreground.setScale(Math.max(coverWidth(parallax.foreground), 2880) / this.foreground.width); front.add(this.foreground) }
    }
    this.middle = scene.add.graphics().fillStyle(0x75d6ff, 0.035)
    for (let i = -3; i < 10; i++) this.middle.fillRect(i * 400, 210, 36, 650)
    back.add(this.middle)
  }
  move(scroll: number): void {
    this.background.setX(960 - scroll * parallax.background)
    this.video?.setX(960 - scroll * parallax.background)
    this.middle.setX(-scroll * parallax.middle)
    this.foreground?.setX(960 - scroll * parallax.foreground)
  }
  setStatic(value: boolean): void {
    this.staticMode = value || this.reduced
    if (this.staticMode) { this.video?.pause(); this.video?.setVisible(false) }
    else if (!this.paused) { this.video?.play(true); this.video?.resume() }
  }
  pause(value: boolean): void {
    this.paused = value
    if (value) this.video?.pause()
    else if (!this.staticMode) { this.video?.play(true); this.video?.resume() }
  }
  destroy(): void {
    this.video?.stop(); this.video?.destroy(); this.background.destroy(); this.middle.destroy(); this.foreground?.destroy()
  }
}
