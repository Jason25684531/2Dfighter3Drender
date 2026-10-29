import Phaser from 'phaser'
import './style.css'
import { createGameConfig } from './game/config/gameConfig'
import { AppStateMachine } from './game/state/AppStateMachine'
import { UIFramework } from './game/ui/UIFramework'
import { ApiClient } from './game/api/ApiClient'
import { ExperienceContext } from './game/app/ExperienceContext'
import { ExperiencePersistence } from './game/app/ExperiencePersistence'
import { ExperienceFlow } from './game/app/ExperienceFlow'
import { MatchController } from './game/match/MatchController'
import { DEFAULT_COMBAT_CONFIG } from './game/combat/CombatWorld'

const appStateMachine = new AppStateMachine()
const ui = new UIFramework(appStateMachine)
const context = new ExperienceContext()
const persistence = new ExperiencePersistence(new ApiClient(), context, typeof window === 'undefined' ? undefined : window.localStorage)
void persistence.restoreSession()
// 訂閱順序：UIFramework → ExperienceFlow → AppScene（Phaser create 時才訂閱）。
const flow = new ExperienceFlow(appStateMachine, ui, new MatchController(DEFAULT_COMBAT_CONFIG, { intro: true }), persistence)

if (import.meta.env.DEV) {
  appStateMachine.subscribe((transition) => console.info('[AppState]', transition))
}

new Phaser.Game(createGameConfig(appStateMachine, ui, flow))
