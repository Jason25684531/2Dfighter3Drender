import Phaser from 'phaser'
import { AppScene } from '../scenes/AppScene'
import { BootScene } from '../scenes/BootScene'
import type { AppStateMachine } from '../state/AppStateMachine'
import type { UIFramework } from '../ui/UIFramework'
import type { ExperiencePersistence } from '../app/ExperiencePersistence'

export const createGameConfig = (appStateMachine: AppStateMachine, ui: UIFramework, persistence?: ExperiencePersistence): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent: 'app',
  width: 1920,
  height: 1080,
  backgroundColor: '#090b12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, new AppScene(appStateMachine, ui, persistence)],
})
