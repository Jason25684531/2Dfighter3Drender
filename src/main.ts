import Phaser from 'phaser'
import './style.css'
import { createGameConfig } from './game/config/gameConfig'
import { AppStateMachine } from './game/state/AppStateMachine'
import { UIFramework } from './game/ui/UIFramework'
import { ApiClient } from './game/api/ApiClient'
import { ExperienceContext } from './game/app/ExperienceContext'
import { ExperiencePersistence } from './game/app/ExperiencePersistence'

const appStateMachine = new AppStateMachine()
const ui = new UIFramework(appStateMachine)
const context = new ExperienceContext()
const persistence = new ExperiencePersistence(new ApiClient(), context, typeof window === 'undefined' ? undefined : window.localStorage)
void persistence.restoreSession()

if (import.meta.env.DEV) {
  appStateMachine.subscribe((transition) => console.info('[AppState]', transition))
}

new Phaser.Game(createGameConfig(appStateMachine, ui, persistence))
