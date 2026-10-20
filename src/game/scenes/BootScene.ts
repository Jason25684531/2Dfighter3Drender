import Phaser from 'phaser'
import { stageTextureKey, testStageManifest } from '../ui/assets/TestAssetManifest'
import { spriteActions, spriteFrameCount, spriteFrameUrl, spriteIds, spriteTextureKey } from '../ui/animation/TemporarySpriteManifest'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload(): void {
    Object.values(testStageManifest).forEach((stage) => this.load.image(stageTextureKey(stage.id), stage.url))
    spriteIds.forEach((id) => spriteActions.forEach((action) => { for (let frame = 0; frame < spriteFrameCount(action); frame += 1) this.load.image(spriteTextureKey(id, action, frame), spriteFrameUrl(id, action, frame)) }))
  }

  async create(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const faces = ['700 24px Oswald', '400 24px Chivo', '700 24px Chivo', '500 24px "Space Grotesk"', '700 24px "Space Grotesk"', '400 24px "Noto Sans TC"', '700 24px "Noto Sans TC"']
    await Promise.race([
      Promise.all(faces.map((face) => document.fonts.load(face, '選擇角色'))).catch(() => undefined),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2000) }),
    ])
    clearTimeout(timeout)
    this.scene.start('AppScene')
  }
}
