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

  create(): void {
    this.scene.start('AppScene')
  }
}
