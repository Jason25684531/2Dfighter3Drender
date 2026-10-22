import Phaser from 'phaser'
import './style.css'
import './prototype.css'
import { ExperiencePrototypeScene } from './game/prototype/ExperiencePrototypeScene'
import { semanticAnimation, type Semantic } from './game/prototype/OperationMapping'

const scene = new ExperiencePrototypeScene()
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'prototype-app', width: 1920, height: 1080, backgroundColor: '#090e1c', dom: { createContainer: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [scene] })
document.querySelector('#selection')!.addEventListener('click', () => scene.resetSelection())
document.querySelector('#battle')!.addEventListener('click', () => scene.show('BATTLE'))
document.querySelector('#input-demo')!.addEventListener('click', () => scene.show('INPUT'))
document.querySelector('#pause')!.addEventListener('click', () => scene.setPaused(true))
document.querySelector('#resume')!.addEventListener('click', () => scene.setPaused(false))
document.querySelector('#pause-dialog')!.addEventListener('cancel', event => { event.preventDefault(); scene.setPaused(false) })
document.querySelector('#static-stage')!.addEventListener('change', event => scene.setStatic((event.target as HTMLInputElement).checked))
const select = document.querySelector<HTMLSelectElement>('#semantic')!
Object.keys(semanticAnimation).forEach(key => select.add(new Option(key, key)))
select.addEventListener('change', () => scene.demonstrate(select.value as Semantic || undefined))
// 原型限定的可觀測入口，沒有正式遊戲或 API 參照。
Object.assign(window, { prototypeGame: game, prototypeScene: scene })
