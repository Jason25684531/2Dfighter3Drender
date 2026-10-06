import Phaser from 'phaser'
import './style.css'
import { createGameConfig } from './game/config/gameConfig'
import { AppStateMachine } from './game/state/AppStateMachine'
import { UIFramework } from './game/ui/UIFramework'

const appStateMachine = new AppStateMachine()
const ui = new UIFramework(appStateMachine)

if (import.meta.env.DEV) {
  appStateMachine.subscribe((transition) => console.info('[AppState]', transition))
}

new Phaser.Game(createGameConfig(appStateMachine, ui))
