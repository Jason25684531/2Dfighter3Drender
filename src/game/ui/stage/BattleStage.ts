import type Phaser from 'phaser'
import type { StageId } from '../assets/TestAssetManifest'
import { StageParallax } from './StageParallax'
import { stageCamera, worldX, WORLD_ZOOM } from './StageCamera'

/** Backdrop, fighters and foreground share one camera transform. */
export class BattleStage {
  readonly world: Phaser.GameObjects.Container
  private readonly back: Phaser.GameObjects.Container
  private readonly front: Phaser.GameObjects.Container
  private readonly parallax: StageParallax
  private scroll = 0

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container, stage: StageId, reduced: boolean, between?: () => void) {
    this.back = scene.add.container(); this.front = scene.add.container()
    this.parallax = new StageParallax(scene, stage, reduced, this.back, this.front)
    root.add(this.back); between?.()
    this.world = scene.add.container(worldX(0), 82).setScale(WORLD_ZOOM)
    root.add([this.world, this.front])
  }
  follow(ax: number, bx: number, dtSec: number): void {
    this.scroll = stageCamera(this.scroll, ax, bx, dtSec)
    this.world.setX(worldX(this.scroll)); this.parallax.move(this.scroll)
  }
  pause(value: boolean): void { this.parallax.pause(value) }
  setStatic(value: boolean): void { this.parallax.setStatic(value) }
  destroy(): void { this.parallax.destroy(); this.back.destroy(); this.front.destroy(); this.world.destroy(true) }
}
