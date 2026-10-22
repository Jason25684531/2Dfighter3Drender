import Phaser from 'phaser'
import { stageTextureKey, testStageManifest } from '../ui/assets/TestAssetManifest'
import { spriteActions, spriteFrameCount, spriteFrameUrl, spriteIds, spriteTextureKey } from '../ui/animation/TemporarySpriteManifest'
import { isSheetSprite, loadSheetSprites, registerSheetAnimations } from '../ui/animation/SheetSpriteManifest'
import { LAB_STAGE_DIR } from '../ui/stage/StageParallax'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload(): void {
    Object.values(testStageManifest).forEach((stage) => this.load.image(stageTextureKey(stage.id), stage.url))
    spriteIds.filter((id) => !isSheetSprite(id)).forEach((id) => spriteActions.forEach((action) => { for (let frame = 0; frame < spriteFrameCount(action); frame += 1) this.load.image(spriteTextureKey(id, action, frame), spriteFrameUrl(id, action, frame)) }))
    loadSheetSprites(this)
    this.load.image('lab-poster', `${LAB_STAGE_DIR}/poster.jpg`)
    this.load.image('lab-foreground', `${LAB_STAGE_DIR}/foreground.png`)
  }

  async create(): Promise<void> {
    registerSheetAnimations(this)
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
