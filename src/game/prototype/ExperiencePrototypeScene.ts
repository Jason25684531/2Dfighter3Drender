import Phaser from 'phaser'
import { BootScene } from '../scenes/BootScene'
import { P1SelectionModel } from '../select/P1SelectionModel'
import { P1SelectView } from '../ui/p1/P1SelectView'
import type { OwnedUiAction, PlayerSlotId } from '../input/InputManager'
import { characterEntry, stageTextureKey, testStageManifest, type StageId } from '../ui/assets/TestAssetManifest'
import { registerSheetAnimations } from '../ui/animation/SheetSpriteManifest'
import { TemporarySpriteRenderer } from '../ui/animation/TemporarySpriteRenderer'
import { MatchController } from '../match/MatchController'
import { GameClock, FIXED_STEP_MS } from '../time/GameClock'
import { combatMapping, menuMapping, resolveDemo, semanticAnimation, type Semantic } from './OperationMapping'
import { stageCamera, worldX, WORLD_ZOOM } from '../ui/stage/StageCamera'
import { ARENA_WIDTH } from '../config/stageTuning'
import { PrototypeHud } from './PrototypeHud'
import { StageParallax } from '../ui/stage/StageParallax'

export type DemoPage = 'P1' | 'P2' | 'CONTROLS' | 'BATTLE' | 'INPUT'
const owners = ['P1', 'P2'] as const
const stages = Object.keys(testStageManifest) as StageId[]

export class ExperiencePrototypeScene extends BootScene {
  page: DemoPage = 'P1'
  model = new P1SelectionModel()
  readonly match = new MatchController()
  readonly clock = new GameClock()
  readonly held = new Set<string>()
  readonly pressed = new Set<string>()
  scroll = 0
  paused = false
  staticStage = false
  selectedStage = 0
  focusedStage = 0
  readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  private view?: P1SelectView
  private root?: Phaser.GameObjects.Container
  private stage?: StageParallax
  private hud?: PrototypeHud
  private world?: Phaser.GameObjects.Container
  private actors: TemporarySpriteRenderer[] = []
  private demoActors: Phaser.GameObjects.Sprite[] = []
  private demoLabels: Phaser.GameObjects.Text[] = []
  private manual?: Semantic
  private semanticKeys = ['', '']
  private unsubscribe?: () => void
  private focusReturn?: HTMLElement
  private readonly dialog = document.querySelector<HTMLDialogElement>('#pause-dialog')!

  async create(): Promise<void> {
    registerSheetAnimations(this)
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    window.addEventListener('blur', this.blur)
    this.events.once('shutdown', () => {
      this.clearPage()
      window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup); window.removeEventListener('blur', this.blur)
    })
    this.show('P1')
  }
  private text(x: number, y: number, value: string, size = 32, color = '#f2f4ff'): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily: 'Chivo, Noto Sans TC, sans-serif', fontSize: `${size}px`, color, align: 'center', wordWrap: { width: 1500 } }).setOrigin(0.5).setDepth(50) // 高於前景層 (20)
  }
  private button(x: number, y: number, value: string, action: () => void): void {
    const bg = this.add.rectangle(x, y, 340, 76, 0x172c48).setStrokeStyle(2, 0x55c9ff).setInteractive({ useHandCursor: true })
    bg.on('pointerup', action); this.text(x, y, value, 26)
  }
  show(page: DemoPage): void {
    this.setPaused(false); this.clearPage(); this.page = page
    document.querySelector('#view-status')!.textContent = `隔離原型 · ${page} · 不寫入 API`
    document.querySelector('#semantic-tools')!.toggleAttribute('hidden', page !== 'INPUT')
    this.cameras.main.setBackgroundColor('#090e1c')
    if (page === 'P1') this.renderP1()
    else if (page === 'P2') this.renderP2()
    else if (page === 'CONTROLS') {
      this.text(960, 200, '即將進入既有 CPU 戰鬥', 54)
      this.text(960, 410, 'A / D 移動　Space 跳躍　J 攻擊　K 防禦', 40)
      this.text(960, 520, '2P 選擇只決定 CPU 外觀。新四種攻擊請到「操作展示」體驗。', 28)
      this.text(960, 600, '每回合 60 秒 · 24Hz · 原型不送出分數', 28, '#f7cf82')
      this.button(760, 800, 'K 返回關卡', () => this.show('P2'))
      this.button(1160, 800, 'J 開始戰鬥', () => this.show('BATTLE'))
    } else this.renderArena(page === 'INPUT')
  }
  resetSelection(): void { this.model = new P1SelectionModel(); this.show('P1') }
  private renderP1(): void {
    this.root = this.add.container(0, 0)
    this.view = new P1SelectView(this, this.root, this.model, {
      offline: true,
      onInput: (owner, action) => this.selectInput(owner, action),
      onFocus: (owner, index) => { this.model.focus(owner, index); this.view?.sync() },
      onNickname: (owner, name) => this.model.setNickname(owner, name),
      onProcessingDone: () => { this.model.completeProcessing(); this.refreshSelection(true) },
      onAllReady: () => this.show('P2'),
    })
  }
  private refreshSelection(rebuild: boolean): void {
    if (rebuild) { this.view?.destroy(); this.root?.destroy(true); this.renderP1() }
    else this.view?.sync()
  }
  private selectInput(owner: PlayerSlotId, action: OwnedUiAction): void {
    if (this.view?.exitOpen) { this.view.handleExit([action]); return }
    if (action === 'BACK' && this.model.phase === 'CUSTOMIZE' && owner === this.model.owner) {
      this.view?.confirmExit(() => { this.model.abortCustomize(); this.refreshSelection(true) }); return
    }
    this.view?.captureOnConfirm(owner, action)
    const phase = this.model.phase, who = this.model.owner
    const feedback = this.model.input(owner, action)
    this.refreshSelection(phase !== this.model.phase && this.model.phase !== 'ALL_READY' || who !== this.model.owner)
    if (feedback) this.view?.feedback(owner, feedback)
  }
  private playerName(owner: PlayerSlotId): string {
    const selection = this.model.result()[owner]
    return selection?.nickname || characterEntry(selection?.characterId)?.displayName || (owner === 'P1' ? 'KEVIN' : 'CPU / KEVIN')
  }
  private renderP2(): void {
    this.text(960, 100, 'SELECT STAGE / 選擇場景', 54)
    owners.forEach((owner, i) => {
      this.text(i ? 1560 : 360, 250, `${owner}${i ? ' / CPU' : ''}\n${this.playerName(owner)}`, 38, i ? '#b5a2ff' : '#ff6576')
      const id = this.model.result()[owner]?.characterId
      this.text(i ? 1560 : 360, 345, id?.startsWith('body') ? `CUSTOM · ${id}` : 'PRESET', 24)
    })
    stages.forEach((id, i) => {
      const x = i ? 1370 : 550
      this.add.image(x, 580, stageTextureKey(id)).setDisplaySize(700, 394)
      const border = this.add.rectangle(x, 580, 710, 404).setStrokeStyle(5, i === this.focusedStage ? 0x49cfff : 0x33415c).setInteractive({ useHandCursor: true })
      border.on('pointerover', () => { if (this.focusedStage !== i) { this.focusedStage = i; this.show('P2') } })
      border.on('pointerup', () => { this.focusedStage = i; this.selectedStage = i; this.show('P2') })
      this.text(x, 825, `${testStageManifest[id].label}${this.selectedStage === i ? '  ✓ SELECTED' : ''}`, 30, this.selectedStage === i ? '#a8ed7e' : '#ffffff')
    })
    this.button(550, 950, 'K 返回選角', () => this.backToSelect())
    this.button(1370, 950, '確認場景 / 下一步', () => this.show('CONTROLS'))
    this.text(960, 1040, 'A/D 或 ←/→ 移焦 · J/Enter 選取 · 再次確認進入操作說明', 24)
  }
  private backToSelect(): void { this.model.input('P1', 'BACK'); this.show('P1') }
  private renderArena(input: boolean): void {
    this.stage = new StageParallax(this, stages[this.selectedStage], this.reduced, this.add.container().setDepth(-30), this.add.container().setDepth(20))
    this.stage.setStatic(this.staticStage)
    this.world = this.add.container(worldX(0), 82).setScale(WORLD_ZOOM)
    if (input) {
      this.demoActors = owners.map((_, i) => {
        const actor = this.add.sprite(ARENA_WIDTH / 2 + (i ? 400 : -400), 820, 'kevin-idle', 0).setOrigin(0.5, 0.9).setScale(3.2).setFlipX(Boolean(i))
        this.world!.add(actor); return actor
      })
      this.demoLabels = owners.map((owner, i) => this.text(i ? 1440 : 480, 270, `${owner} IDLE`, 32, i ? '#b5a2ff' : '#ff6576'))
      this.text(960, 100, '動作語意展示 / 無傷害、無勝負', 48)
      this.text(960, 990, '1P: ADWS · F/U/G/I　　2P: 方向鍵 · Numpad 1/2/4/5', 28)
      this.updateDemo()
    } else {
      this.match.start()
      this.actors = owners.map((owner, i) => {
        const selection = this.model.result()[owner]
        const entry = characterEntry(selection?.characterId)
        const actor = new TemporarySpriteRenderer(this, entry?.type === 'BODY_TEMPLATE' ? 'kevin' : entry?.spriteId ?? 'kevin', i ? 0x8070ff : 0xff4560, 820)
        this.world!.add(actor); return actor
      })
      this.hud = new PrototypeHud(this, owners.map(owner => this.playerName(owner)), this.reduced)
      this.text(960, 1000, '既有 CPU 戰鬥：A/D 移動 · W/S 縱深 · Space 跳躍 · J 攻擊 · K 防禦 · Esc 暫停', 26).setDepth(100)
      const sync = () => {
        const snapshot = this.match.getSnapshot()
        ;[snapshot.world.fighters.PLAYER, snapshot.world.fighters.ENEMY].forEach((fighter, i) => { this.actors[i].update(fighter, snapshot.world.tick) })
        this.hud?.sync(snapshot)
      }
      sync()
      this.unsubscribe = this.clock.subscribe(() => {
        this.match.tick({ moveX: Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')), moveZ: Number(this.held.has('KeyW')) - Number(this.held.has('KeyS')), jumpPressed: this.pressed.has('Space'), attackPressed: this.pressed.has('KeyJ'), guardHeld: this.held.has('KeyK') })
        this.pressed.clear(); sync()
      })
      this.clock.reset(); this.clock.start()
    }
  }
  demonstrate(semantic?: Semantic): void { if (this.page !== 'INPUT' || this.paused) return; this.manual = semantic; this.held.clear(); this.updateDemo() }
  private updateDemo(): void {
    this.demoActors.forEach((actor, i) => {
      const semantic = this.manual ?? resolveDemo(this.held, i ? 'LEFT' : 'RIGHT', combatMapping[owners[i]])
      this.demoLabels[i].setText(`${owners[i]}  ${semantic}`)
      if (this.semanticKeys[i] === semantic) return
      this.semanticKeys[i] = semantic
      const key = `kevin-${semanticAnimation[semantic]}`
      if (this.reduced) actor.stop().setTexture(key, 0)
      else actor.play(key)
    })
  }
  setStatic(value: boolean): void { this.staticStage = value; this.stage?.setStatic(value) }
  setPaused(value: boolean): void {
    if (this.paused === value) return
    this.paused = value; this.held.clear(); this.pressed.clear()
    this.stage?.pause(value); this.time.paused = value; this.input.enabled = !value
    if (value) {
      this.clock.pause(); this.tweens.pauseAll(); this.anims.pauseAll()
      this.focusReturn = document.activeElement as HTMLElement
      this.dialog.showModal()
    } else {
      this.clock.resume(); this.tweens.resumeAll(); this.anims.resumeAll(); this.dialog.close(); this.focusReturn?.focus()
      if (this.page === 'INPUT') this.updateDemo()
    }
  }
  private readonly blur = (): void => { this.held.clear(); this.pressed.clear(); if (this.page === 'BATTLE' || this.page === 'INPUT') this.setPaused(true) }
  private readonly keyup = (event: KeyboardEvent): void => { this.held.delete(event.code); if (this.page === 'INPUT' && !this.paused) this.updateDemo() }
  private readonly keydown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement)?.matches('input, textarea, select, [contenteditable=true]') || event.isComposing) return
    if (this.paused) { if (['Escape', 'Enter', 'KeyJ', 'KeyK', 'Backspace'].includes(event.code)) { event.preventDefault(); this.setPaused(false) }; return }
    if (event.code === 'Escape') { event.preventDefault(); this.setPaused(true); return }
    if ((event.target as HTMLElement)?.matches('button') && ['Enter', 'Space'].includes(event.code)) return
    const relevant = [...Object.keys(menuMapping.P1), ...Object.keys(menuMapping.P2), ...Object.values(combatMapping.P1), ...Object.values(combatMapping.P2), 'Space']
    if (!relevant.includes(event.code)) return
    event.preventDefault()
    if (!this.held.has(event.code)) this.pressed.add(event.code)
    this.held.add(event.code)
    if (this.page === 'INPUT') { this.manual = undefined; this.updateDemo(); return }
    if (this.page === 'BATTLE' || event.repeat) return
    for (const owner of owners) {
      const action = menuMapping[owner][event.code]
      if (!action) continue
      if (this.page === 'P1') this.selectInput(owner, action)
      else if (this.page === 'P2') {
        if (action === 'BACK') this.backToSelect()
        else if (action === 'CONFIRM') { if (this.selectedStage === this.focusedStage) this.show('CONTROLS'); else { this.selectedStage = this.focusedStage; this.show('P2') } }
        else { this.focusedStage = 1 - this.focusedStage; this.show('P2') }
      } else if (this.page === 'CONTROLS') { if (action === 'CONFIRM') this.show('BATTLE'); else if (action === 'BACK') this.show('P2') }
      break
    }
  }
  update(_time: number, delta: number): void {
    if (this.paused || !this.world) return
    if (this.page === 'BATTLE') {
      this.clock.advance(delta)
      this.actors.forEach(actor => actor.renderAt(this.clock.getRemainderMs() / FIXED_STEP_MS))
    }
    const actors = this.page === 'BATTLE' ? this.actors : this.demoActors
    if (actors.length !== 2) return
    if (this.page === 'INPUT' && !this.manual) this.demoActors.forEach((actor, i) => {
      const binding = combatMapping[owners[i]]
      actor.x = Phaser.Math.Clamp(actor.x + (Number(this.held.has(binding.right)) - Number(this.held.has(binding.left))) * Math.min(delta, 50) * 0.4, 60, ARENA_WIDTH - 60)
    })
    this.scroll = stageCamera(this.scroll, actors[0].x, actors[1].x, this.reduced ? Infinity : delta / 1000)
    this.world.x = worldX(this.scroll)
    this.stage?.move(this.scroll)
  }
  private clearPage(): void {
    this.held.clear(); this.pressed.clear(); this.clock.stop(); this.unsubscribe?.(); this.unsubscribe = undefined
    this.view?.destroy(); this.view = undefined; this.root = undefined
    this.hud?.destroy(); this.hud = undefined; this.stage?.destroy(); this.stage = undefined
    this.children.removeAll(true); this.time.removeAllEvents(); this.tweens.killAll()
    this.world = undefined; this.actors = []; this.demoActors = []; this.demoLabels = []; this.semanticKeys = ['', '']; this.manual = undefined; this.scroll = 0
  }
}
