import Phaser from 'phaser'
import type { OwnedUiAction, PlayerSlotId, UIAction } from '../../input/InputManager'
import { GRID_COLUMNS, NICKNAME_MAX, sectionCounts, sectionOf, type P1SelectionModel, type SelectFeedback, type Slot } from '../../select/P1SelectionModel'
import { ActionButton, AngularPanel, fighterSilhouette } from '../VisualComponents'
import { spriteDisplayHeight, spriteOriginY, spriteTextureFrame, spriteTextureKey } from '../animation/TemporarySpriteManifest'
import { isSheetSprite } from '../animation/SheetSpriteManifest'
import { colorHex, reducedMotion, uiTokens, type UiColorToken } from '../tokens/uiTokens'
import { typography } from '../tokens/typography'
import { stopOwnedTweens } from '../tweens'

export type P1ViewHooks = {
  offline: boolean
  onInput: (owner: PlayerSlotId, action: OwnedUiAction) => void
  onFocus: (owner: PlayerSlotId, index: number) => void
  onNickname: (owner: PlayerSlotId, name: string) => void
  onProcessingDone: () => void
  onAllReady: () => void
}

const { p1, colors, type } = uiTokens
const identity: Record<PlayerSlotId, { main: number; glow: number; text: UiColorToken; tag: string; label: string; keys: string; back: string; confirm: string }> = {
  P1: { main: colors.playerPrimary, glow: colors.playerGlow, text: 'playerGlow', tag: '1P', label: 'PLAYER 1', keys: 'W A S D', confirm: 'J', back: 'K' },
  P2: { main: colors.enemyPrimary, glow: colors.enemyGlow, text: 'enemyGlow', tag: '2P', label: 'PLAYER 2', keys: '↑ ↓ ← →', confirm: 'ENTER', back: 'BACKSPACE' },
}
const pad = (index: number): string => String(index).padStart(2, '0')
// 第 2 列起下移一段，讓 ROSTER 標題有位置；所有游標／格子都經過 cellCenter，導覽不受影響。
const SECTION_GAP = 34
const cellCenter = (index: number): { x: number; y: number } => {
  const column = (index - 1) % GRID_COLUMNS, row = Math.floor((index - 1) / GRID_COLUMNS)
  return { x: p1.grid.x + p1.grid.cellWidth / 2 + column * (p1.grid.cellWidth + p1.grid.gap), y: p1.grid.y + p1.grid.cellHeight / 2 + row * (p1.grid.cellHeight + p1.grid.gap) + (row > 0 ? SECTION_GAP : 0) }
}
const slotKind = (slot: Slot): string => slot.type === 'EMPTY' ? 'EMPTY SLOT' : sectionOf(slot.index)
const label = (scene: Phaser.Scene, x: number, y: number, text: string, color: UiColorToken = 'textSecondary', size: number = type.label): Phaser.GameObjects.Text => scene.add.text(x, y, text, { ...typography.note, fontSize: size, color: colorHex(color) })
const glowOn = (object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics, color: number, strength = 4): void => { if (object.scene.game.renderer.type === Phaser.WEBGL) object.postFX?.addGlow(color, strength, 0, false, 0.1, 12) }

/** DEPTH 2：大型角色主體。內容只在格子/鎖定變化時替換，不重建畫面。 */
class HeroPreview extends Phaser.GameObjects.Container {
  private readonly stage: Phaser.GameObjects.Container
  private readonly beam: Phaser.GameObjects.Graphics
  private readonly title: Phaser.GameObjects.Text
  private readonly kind: Phaser.GameObjects.Text
  private figure?: Phaser.GameObjects.Sprite | Phaser.GameObjects.Graphics
  private stamp?: Phaser.GameObjects.Text
  private key = ''
  private pulse?: Phaser.Tweens.Tween
  private flash?: Phaser.Time.TimerEvent
  private readonly tweens: Phaser.Tweens.Tween[] = []

  constructor(scene: Phaser.Scene, private readonly owner: PlayerSlotId) {
    super(scene, p1.hero.x[owner], p1.hero.footY)
    const id = identity[owner], left = owner === 'P1'
    // 光柱與速度線畫成朝右（朝中央），P2 整組鏡像。
    this.stage = scene.add.container(0, 0).setScale(left ? 1 : -1, 1)
    this.beam = scene.add.graphics()
    this.beam.fillStyle(id.main, 1).fillPoints([new Phaser.Math.Vector2(-230, 60), new Phaser.Math.Vector2(110, 60), new Phaser.Math.Vector2(330, -780), new Phaser.Math.Vector2(-10, -780)], true)
    const lines = scene.add.graphics().lineStyle(2, id.glow, 0.5)
    for (let i = 0; i < 7; i += 1) lines.lineBetween(-160 + i * 50, 40, -20 + i * 50, -500)
    this.stage.add([this.beam, lines, scene.add.ellipse(0, 0, 440, 74, id.main, 0.22), scene.add.ellipse(0, 4, 300, 44, colors.shadow, 0.5)])
    if (!reducedMotion) this.tweens.push(scene.tweens.add({ targets: lines, y: -60, duration: 2000, repeat: -1 }))
    this.title = scene.add.text(left ? 96 - this.x : 1824 - this.x, 330 - this.y, '', { ...typography.title, fontSize: type.h1, color: colorHex(id.text), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.standard }).setOrigin(left ? 0 : 1, 0.5)
    this.kind = label(scene, this.title.x, 384 - this.y, '').setOrigin(left ? 0 : 1, 0.5)
    this.add([this.stage, this.title, this.kind])
  }

  /** stamp：READY＝已就緒；LOCKED＝已鎖定 Body、尚待拍照。 */
  show(slot: Slot | undefined, stamp: 'READY' | 'LOCKED' | undefined, nickname = '', dim = false): void {
    const key = `${slot?.index}|${stamp}|${nickname}|${dim}|${slot?.entry?.spriteId}|${slot?.entry?.type}|${slot?.entry?.heroTextureKey}`
    if (key === this.key) return
    const relock = Boolean(stamp) && this.key.split('|')[1] === 'undefined'
    this.key = key
    const id = identity[this.owner]
    this.flash?.remove(); this.figure?.destroy(); this.stamp?.destroy(); this.stamp = undefined
    this.beam.setAlpha(slot ? (stamp ? 0.55 : 0.3) : 0.12)
    this.setAlpha(dim ? 0.4 : 1)
    const body = slot?.type === 'BODY_TEMPLATE', sprite = slot?.entry?.spriteId
    const texture = slot?.entry?.heroTextureKey ?? (sprite && spriteTextureKey(sprite, 'idle'))
    if (texture && this.scene.textures.exists(texture)) {
      const image = this.scene.add.sprite(0, 0, texture, slot?.entry?.heroTextureKey ? undefined : spriteTextureFrame(sprite)).setOrigin(0.5, slot?.entry?.heroTextureKey ? 1 : sprite ? spriteOriginY(sprite) : 1).setFlipX(this.owner === 'P2')
      if (isSheetSprite(sprite) && !body && !slot?.entry?.heroTextureKey && !reducedMotion && this.scene.anims.exists(`${sprite}-idle`)) image.play(`${sprite}-idle`)
      image.setScale(p1.hero.height / image.height * (slot?.entry?.heroTextureKey ? 1 : sprite ? spriteDisplayHeight(sprite) / 520 : 1))
      // Body 只顯示身形剪影（暫用替身 sprite 的輪廓），不冒充已生成角色。
      if (body && !slot?.entry?.heroTextureKey) { image.setTintFill(colors.textPrimary).setAlpha(0.5); glowOn(image, colors.resultGold, 3) }
      else glowOn(image, id.main)
      if (relock && !body && !reducedMotion) { image.setTintFill(colors.textPrimary); this.flash = this.scene.time.delayedCall(60, () => image.active && image.clearTint()) }
      this.figure = image
    } else {
      this.figure = fighterSilhouette(this.scene, 0, -440, 300, 720, slot ? colors.textSecondary : id.main, 0.22)
    }
    this.addAt(this.figure, 1)
    this.title.setText(slot ? (nickname || slot.entry?.displayName || 'EMPTY') : 'PRESS ENTER')
    this.kind.setText(slot ? `${pad(slot.index)} · ${slot.type === 'BODY_TEMPLATE' ? 'CUSTOM BODY · CREATE YOUR FIGHTER' : slotKind(slot)}${nickname ? ' · ' + (slot.entry?.displayName ?? '') : ''}` : 'TO JOIN · 按 ENTER 加入')
    this.pulse?.stop(); this.title.setAlpha(1)
    if (!slot && !reducedMotion) this.pulse = this.scene.tweens.add({ targets: this.title, alpha: 0.45, duration: 600, yoyo: true, repeat: -1 })
    if (stamp) {
      this.stamp = this.scene.add.text(0, -250, stamp, { ...typography.title, fontSize: type.h1, color: colorHex(stamp === 'READY' ? 'statusLime' : 'resultGold'), stroke: colorHex('background0'), strokeThickness: uiTokens.textStroke.badge }).setOrigin(0.5).setRotation(-0.08)
      this.add(this.stamp)
    }
  }

  destroy(fromScene?: boolean): void { this.flash?.remove(); this.pulse?.stop(); stopOwnedTweens(this.tweens); super.destroy(fromScene) }
}

/** DEPTH 3：單一格子。 */
class GridSlotView extends AngularPanel {
  private readonly readyTags: Record<PlayerSlotId, Phaser.GameObjects.Container>
  private readonly statusLabel: Phaser.GameObjects.Text
  private readonly scan: Phaser.GameObjects.Rectangle
  private scanTween?: Phaser.Tweens.Tween
  private status?: string
  constructor(scene: Phaser.Scene, readonly slot: Slot) {
    super(scene, p1.grid.cellWidth, p1.grid.cellHeight, slot.entry ? colors.panelRaised : colors.background0, 0.9, { slant: 10 })
    const body = slot.type === 'BODY_TEMPLATE', empty = !slot.entry
    const { x, y } = cellCenter(slot.index); this.setPosition(x, y)
    this.shape.setStrokeStyle(body ? 2 : 1, body ? colors.resultGold : colors.lineDim, empty ? 0.5 : 0.9)
    if (body) {
      const stripes = scene.add.graphics().lineStyle(5, p1.bodyHazard.color, p1.bodyHazard.alpha)
      for (let x = -40; x < 30; x += p1.bodyHazard.spacing) stripes.lineBetween(x, 48, x + 20, -48)
      this.add(stripes)
    }
    if (empty) {
      this.shape.setStrokeStyle(0)
      const dash = scene.add.graphics().lineStyle(1, colors.lineDim, 0.8)
      for (let x = -36; x < 36; x += 10) { dash.lineBetween(x, -51, x + 5, -51); dash.lineBetween(x, 51, x + 5, 51) }
      for (let y = -48; y < 48; y += 10) { dash.lineBetween(-44, y, -44, y + 5); dash.lineBetween(44, y, 44, y + 5) }
      this.add(dash)
    }
    const sprite = !body ? slot.entry?.spriteId : undefined
    if (sprite && scene.textures.exists(spriteTextureKey(sprite, 'idle'))) this.add(scene.add.image(0, -4, spriteTextureKey(sprite, 'idle'), spriteTextureFrame(sprite)).setDisplaySize(84, 84))
    if (body) this.add([fighterSilhouette(scene, 0, -12, 46, 70, colors.textPrimary, 0.55), label(scene, 0, -14, '+', 'resultGold', type.h2).setOrigin(0.5)])
    this.add(label(scene, -40, -48, pad(slot.index), body ? 'resultGold' : 'textSecondary'))
    this.add(label(scene, 0, 38, empty ? 'EMPTY' : (slot.entry?.displayName ?? '').slice(0, 8), empty ? 'textSecondary' : 'textPrimary').setOrigin(0.5).setAlpha(empty ? 0.55 : 1))
    const tag = (owner: PlayerSlotId, offset: number): Phaser.GameObjects.Container => {
      const id = identity[owner]
      return scene.add.container(0, offset, [scene.add.rectangle(0, 0, p1.grid.cellWidth, 22, id.main, 0.95), label(scene, 0, 0, `${id.tag} READY`, 'textPrimary').setOrigin(0.5)]).setVisible(false)
    }
    this.readyTags = { P1: tag('P1', 18), P2: tag('P2', 40) }
    this.add(Object.values(this.readyTags))
    this.scan = scene.add.rectangle(0, 0, 80, 8, colors.systemBlue, 0.4).setVisible(false)
    this.statusLabel = label(scene, 36, -40, '', 'statusLime').setOrigin(1, 0.5)
    this.add([this.scan, this.statusLabel]); this.syncStatus()
    this.setInteractive({ useHandCursor: true })
  }
  setReady(owner: PlayerSlotId, ready: boolean): void { this.readyTags[owner].setVisible(ready) }
  syncStatus(): void {
    const status = this.slot.status
    if (this.status === status) return
    this.status = status; this.scanTween?.stop(); this.scan.setVisible(status === 'PROCESSING')
    if (this.slot.entry) this.shape.setStrokeStyle(this.slot.type === 'BODY_TEMPLATE' ? 2 : 1, this.slot.type === 'BODY_TEMPLATE' ? colors.resultGold : colors.lineDim, 0.9)
    this.statusLabel.setText(status === 'READY' ? 'NEW' : status === 'FAILED' ? '!' : status === 'PROCESSING' ? '…' : '').setColor(colorHex(status === 'FAILED' ? 'danger' : status === 'PROCESSING' ? 'systemBlue' : 'statusLime'))
    this.setAlpha(status === 'FAILED' ? 0.6 : 1)
    if (status === 'FAILED' || status === 'PROCESSING') this.shape.setStrokeStyle(2, status === 'FAILED' ? colors.danger : colors.systemBlue)
    if (status === 'PROCESSING' && !reducedMotion) this.scanTween = this.scene.tweens.add({ targets: this.scan, y: { from: 44, to: -44 }, duration: 1200, repeat: -1 })
  }
  destroy(fromScene?: boolean): void { this.scanTween?.stop(); super.destroy(fromScene) }
}

/** DEPTH 4：玩家游標。 */
class PlayerCursor extends Phaser.GameObjects.Container {
  private readonly frame: Phaser.GameObjects.Graphics
  private readonly glow: Phaser.GameObjects.Graphics
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private index = 0
  private outset = -1
  private locked?: boolean
  private shared?: boolean
  private slide?: Phaser.Tweens.Tween
  private shakeTween?: Phaser.Tweens.Tween
  constructor(scene: Phaser.Scene, private readonly owner: PlayerSlotId) {
    super(scene, 0, 0)
    const id = identity[owner], left = owner === 'P1'
    this.glow = scene.add.graphics(); this.frame = scene.add.graphics()
    const tagX = left ? -p1.grid.cellWidth / 2 - 6 : p1.grid.cellWidth / 2 + 6, tagY = left ? -p1.grid.cellHeight / 2 - 14 : p1.grid.cellHeight / 2 + 14
    const tag = scene.add.container(tagX, tagY, [scene.add.rectangle(0, 0, 34, 24, id.main), label(scene, 0, 0, id.tag, 'textPrimary').setOrigin(0.5)])
    this.add([this.glow, this.frame, tag])
    if (!reducedMotion) this.tweens.push(scene.tweens.add({ targets: this.glow, alpha: 0.35, duration: p1.cursor.breatheMs, yoyo: true, repeat: -1 }))
  }
  place(index: number, locked: boolean, shared: boolean): void {
    const outset = p1.cursor.outset
    if (index !== this.index) {
      const { x, y } = cellCenter(index)
      this.slide?.stop(); this.shakeTween?.stop()
      if (this.index && p1.cursor.slideMs) this.slide = this.scene.tweens.add({ targets: this, x, y, duration: p1.cursor.slideMs, ease: 'Cubic.Out' })
      else this.setPosition(x, y)
      this.index = index
    }
    if (outset === this.outset && locked === this.locked && shared === this.shared) return
    this.outset = outset; this.locked = locked; this.shared = shared
    this.tweens.forEach((tween) => locked ? tween.pause() : tween.resume()); this.glow.setAlpha(1)
    const id = identity[this.owner], w = p1.grid.cellWidth + outset * 2, h = p1.grid.cellHeight + outset * 2
    const outline = (g: Phaser.GameObjects.Graphics, inset = 0): void => {
      const x = w / 2 - inset, y = h / 2 - inset
      if (!shared) { g.strokeRect(-x, -y, x * 2, y * 2); return }
      g.beginPath().moveTo(-x, y).lineTo(this.owner === 'P1' ? -x : x, this.owner === 'P1' ? -y : y).lineTo(x, -y).strokePath()
    }
    this.frame.clear().lineStyle(p1.cursor.width, id.main, 1); outline(this.frame)
    if (locked) { this.frame.lineStyle(2, colors.textPrimary, 0.9); outline(this.frame, 6) }
    this.glow.clear().lineStyle(12, id.glow, locked ? 0.15 : 0.35); outline(this.glow)
  }
  shake(): void {
    if (reducedMotion) return
    this.slide?.stop(); this.shakeTween?.stop()
    const { x, y } = cellCenter(this.index); this.setPosition(x, y)
    this.shakeTween = this.scene.tweens.add({ targets: this, x: x + 6, duration: 30, yoyo: true, repeat: 2, onComplete: () => { this.x = x } })
  }
  destroy(fromScene?: boolean): void { this.slide?.stop(); this.shakeTween?.stop(); stopOwnedTweens(this.tweens); super.destroy(fromScene) }
}

export class P1SelectView {
  private readonly heroes = {} as Record<PlayerSlotId, HeroPreview>
  private readonly cursors = {} as Partial<Record<PlayerSlotId, PlayerCursor>>
  private readonly slotViews: GridSlotView[] = []
  private readonly plates = {} as Partial<Record<PlayerSlotId, { status: Phaser.GameObjects.Text; detail: Phaser.GameObjects.Text }>>
  private readonly tweens: Phaser.Tweens.Tween[] = []
  private readonly timers: Phaser.Time.TimerEvent[] = []
  private modeText?: Phaser.GameObjects.Text
  private keysP2?: Phaser.GameObjects.Text
  private keysP1?: Phaser.GameObjects.Text
  private stepLabel?: Phaser.GameObjects.Text
  private banner?: Phaser.GameObjects.Container
  private bannerTimer?: Phaser.Time.TimerEvent
  private bannerTween?: Phaser.Tweens.Tween
  private nameInput?: Phaser.GameObjects.DOMElement
  // media：Capture 的 webcam <video> 或 Review 的照片 <img>；DOM 會疊在 Canvas 上，離開確認框開啟時需隱藏。
  private media?: Phaser.GameObjects.DOMElement
  private stream?: MediaStream
  private takePhoto?: ActionButton
  private nameHint?: Phaser.GameObjects.Text
  private nameCount?: Phaser.GameObjects.Text
  private hint?: Phaser.GameObjects.Text
  private offlineLabel?: Phaser.GameObjects.Text
  private exitPanel?: Phaser.GameObjects.Container
  private exitButtons: ActionButton[] = []
  private exitChoice = 0
  private onExit?: () => void

  get exitOpen(): boolean { return Boolean(this.exitPanel) }
  setOffline(): void { this.offlineLabel?.setText('● OFFLINE · 成績不會被記錄').setColor(colorHex('danger')) }

  confirmExit(onExit: () => void): void {
    if (this.exitPanel) return
    this.onExit = onExit; this.exitChoice = 0
    this.timers.forEach((timer) => { timer.paused = true })
    if (this.nameInput) this.nameInput.setVisible(false)
    this.media?.setVisible(false)
    const panel = this.scene.add.container(960, 540)
    panel.add(this.scene.add.rectangle(0, 0, 1920, 1080, colors.background0, 0.85).setInteractive())
    panel.add(new AngularPanel(this.scene, 760, 340, colors.panelRaised))
    panel.add(label(this.scene, 0, -100, 'RETURN TO GRID? · 返回選角？', 'textPrimary', type.title).setOrigin(0.5))
    panel.add(label(this.scene, 0, -42, '只解除目前玩家的鎖定', 'textSecondary', type.body).setOrigin(0.5))
    this.exitButtons = ['CANCEL', 'CONFIRM'].map((text, i) => {
      const button = new ActionButton(this.scene, text, 300, 80, i ? colors.playerPrimary : colors.panel).setPosition(i ? 170 : -170, 80)
      button.on('pointerup', () => this.closeExit(i === 1)); panel.add(button); return button
    })
    this.exitButtons[0].setFocused(true); this.root.add(panel); this.exitPanel = panel
  }

  handleExit(actions: UIAction[]): void {
    for (const action of actions) {
      if (!this.exitPanel) break
      if (action === 'BACK') this.closeExit(false)
      else if (action === 'CONFIRM') this.closeExit(this.exitChoice === 1)
      else if (action.startsWith('NAV_')) { this.exitChoice = 1 - this.exitChoice; this.exitButtons.forEach((button, i) => button.setFocused(i === this.exitChoice)) }
    }
  }

  private closeExit(confirm: boolean): void {
    this.exitPanel?.destroy(true); this.exitPanel = undefined; this.exitButtons = []
    this.timers.forEach((timer) => { timer.paused = false }); this.nameInput?.setVisible(true); this.media?.setVisible(true)
    if (confirm) this.onExit?.()
  }

  constructor(private readonly scene: Phaser.Scene, private readonly root: Phaser.GameObjects.Container, private readonly model: P1SelectionModel, private readonly hooks: P1ViewHooks) {
    const customizing = Boolean(model.owner)
    this.header(customizing)
    ;(['P1', 'P2'] as const).forEach((owner) => { this.heroes[owner] = new HeroPreview(scene, owner); root.add(this.heroes[owner]) })
    if (customizing) this.buildChamber(); else this.buildGrid()
    this.sync()
    if (!reducedMotion && model.phase === 'GRID') {
      ;(['P1', 'P2'] as const).forEach((owner) => {
        const panel = new AngularPanel(scene, 1050, 1200, identity[owner].main, 0.8, { slant: 140 }).setPosition(owner === 'P1' ? 480 : 1440, 540)
        root.add(panel); this.tweens.push(scene.tweens.add({ targets: panel, x: owner === 'P1' ? -600 : 2520, alpha: 0, duration: 300, onComplete: () => panel.destroy() }))
      })
    }
    if (!reducedMotion && model.phase === 'REVIEW') {
      const shutter = scene.add.rectangle(960, 640, 640, 340, colors.textPrimary); root.add(shutter)
      this.tweens.push(scene.tweens.add({ targets: shutter, alpha: 0, duration: 80, onComplete: () => shutter.destroy() }))
    }
  }

  sync(): void {
    const { model } = this
    const customizing = Boolean(model.owner)
    ;(['P1', 'P2'] as const).forEach((owner) => {
      const player = model.player(owner), hero = model.heroSlot(owner)
      const stamp = model.owner === owner ? undefined : model.isReady(owner) ? 'READY' : player.locked !== undefined ? 'LOCKED' : undefined
      this.heroes[owner].show(hero, stamp, model.isBody(owner) ? player.nickname.trim() : '', customizing && owner !== model.owner)
      const plate = this.plates[owner]
      if (plate) {
        const status = model.status(owner)
        plate.status.setText(status === 'JOIN' ? 'PRESS ENTER TO JOIN' : status === 'WAITING' ? 'READY · WAITING' : status).setColor(colorHex(status === 'READY' || status === 'WAITING' ? 'statusLime' : status === 'CUSTOMIZE' ? 'resultGold' : 'textSecondary'))
        plate.detail.setText(hero ? `${pad(hero.index)} · ${hero.entry?.displayName ?? 'EMPTY'} · ${slotKind(hero)}` : 'ENTER 加入 · 2P 角色由 CPU 操作')
      }
      const cursor = this.cursors[owner]
      if (cursor) {
        cursor.setVisible(player.joined)
        const other = model.player(owner === 'P1' ? 'P2' : 'P1')
        if (player.joined) cursor.place(player.locked ?? player.cursor, player.locked !== undefined, other.joined && (other.locked ?? other.cursor) === (player.locked ?? player.cursor))
      }
      this.slotViews.forEach((view) => { view.setReady(owner, player.joined && player.locked === view.slot.index && model.isReady(owner)); view.syncStatus() })
    })
    const duo = model.player('P2').joined
    const commands = (owner: PlayerSlotId): string => {
      const player = model.player(owner), id = identity[owner]
      return !player.joined ? '2P  ENTER 加入' : player.locked !== undefined ? `${id.tag}  ${id.back} 解除鎖定` : `${id.tag}  ${id.keys} 移動 · ${id.confirm} 確認${owner === 'P2' ? ' · BACKSPACE 退出' : ''}`
    }
    this.keysP1?.setText(commands('P1'))
    this.stepLabel?.setText(customizing ? '02 / 04 · 自訂角色' : `01 / ${model.slots.some(slot => slot.type === 'BODY_TEMPLATE' && (model.player('P1').locked === slot.index || model.player('P2').locked === slot.index)) ? '04' : '03'} · 選擇角色`)
    this.modeText?.setText(duo ? '1P · 2P  —  2P = CPU · 2P 角色由 CPU 操作' : '1P VS CPU · 單人挑戰')
    this.keysP2?.setText(commands('P2'))
    if (model.phase === 'ALL_READY' && !this.banner) this.showBanner()
    if (model.phase !== 'ALL_READY' && this.banner) { this.bannerTimer?.remove(); this.bannerTween?.stop(); this.banner.destroy(); this.banner = undefined }
  }

  feedback(owner: PlayerSlotId, feedback: SelectFeedback): void {
    if (feedback === 'REJECTED') {
      this.cursors[owner]?.shake()
      const slot = this.model.heroSlot(owner)
      if (!this.hint) { this.hint = label(this.scene, 960, 444, '', 'resultGold', type.body).setOrigin(0.5); this.root.add(this.hint) }
      this.hint.setText(slot?.type === 'EMPTY' ? 'EMPTY SLOT · 空位不可選取' : slot?.status === 'PROCESSING' ? 'PROCESSING · 處理中' : 'UNAVAILABLE · 暫不可用')
    }
    if (feedback === 'JOIN_HINT' && !reducedMotion) this.tweens.push(this.scene.tweens.add({ targets: this.heroes.P2, alpha: 0.55, duration: 90, yoyo: true }))
    if (feedback === 'NAME_REQUIRED') { this.nameHint?.setVisible(true); (this.nameInput?.node as HTMLInputElement | undefined)?.focus() }
  }

  destroy(): void {
    stopOwnedTweens(this.tweens); this.timers.splice(0).forEach((timer) => timer.remove()); this.bannerTimer?.remove(); this.bannerTween?.stop()
    this.nameInput?.destroy(); this.nameInput = undefined
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; this.media?.destroy(); this.media = undefined
  }

  /** Capture 按下確認時先擷取 webcam 畫面；照片只存在 model 記憶體，沒有相機時保持 Mock。 */
  captureOnConfirm(owner: PlayerSlotId, action: OwnedUiAction): void {
    const video = this.media?.node
    if (this.model.phase !== 'CUSTOMIZE' || owner !== this.model.owner || action !== 'CONFIRM' || !this.model.nicknameValid(owner) || !(video instanceof HTMLVideoElement) || !video.videoWidth) return
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = Math.round(640 * video.videoHeight / video.videoWidth)
    const context = canvas.getContext('2d'); if (!context) return
    context.translate(canvas.width, 0); context.scale(-1, 1) // 與鏡像預覽一致
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    this.model.setPhoto(owner, canvas.toDataURL('image/jpeg', 0.85))
  }

  private startCamera(note: Phaser.GameObjects.Text, band: Phaser.GameObjects.Text): void {
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.autoplay = true; video.setAttribute('aria-label', 'Camera preview')
    video.style.cssText = 'width:636px;height:336px;object-fit:cover;transform:scaleX(-1);background:#000;display:none'
    this.media = this.scene.add.dom(960, 640, video)
    const fail = (): void => { if (note.active) note.setText('CAMERA UNAVAILABLE · 相機無法使用，將使用模擬照片').setColor(colorHex('resultGold')) }
    if (!navigator.mediaDevices?.getUserMedia) { fail(); return }
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false }).then((stream) => {
      if (this.media?.node !== video) { stream.getTracks().forEach((track) => track.stop()); return } // 授權回來前已離開 Capture
      this.stream = stream; video.srcObject = stream; video.style.display = 'block'; note.setVisible(false)
      band.setText('LOCAL CAMERA · 本機相機 · 不上傳、不生成')
    }, fail)
  }

  private header(customizing: boolean): void {
    const { scene, root } = this
    root.add(scene.add.text(96, 96, customizing ? 'CUSTOMIZE YOUR FIGHTER' : 'CHARACTER SELECT', typography.heading).setOrigin(0, 0.5))
    this.stepLabel = label(scene, customizing ? 940 : 740, 110, '', 'textPrimary', type.body).setOrigin(0, 0.5); root.add(this.stepLabel)
    this.offlineLabel = label(scene, 1824, 90, this.hooks.offline ? '● OFFLINE · 成績不會被記錄' : '● ONLINE', this.hooks.offline ? 'danger' : 'statusLime').setOrigin(1, 0.5)
    root.add(this.offlineLabel)
  }

  private buildGrid(): void {
    const { scene, root, model } = this
    // 三區：CUSTOMIZE 01–04、OFFICERS 05–10 在第 1 列；ROSTER 11–40 在其下。各區有標題條、計數與括框。
    const counts = sectionCounts(model.slots), cellW = p1.grid.cellWidth, gap = p1.grid.gap, step = cellW + gap
    const section = (text: string, firstColumn: number, columns: number, top: number, height: number, color: number, textColor: UiColorToken): void => {
      const width = columns * cellW + (columns - 1) * gap, x = p1.grid.x + firstColumn * step + width / 2
      root.add(scene.add.rectangle(x, top + height / 2, width + 10, height + 10).setStrokeStyle(2, color, 0.8))
      const tag = new AngularPanel(scene, width, 28, color, 1, { slant: 10 }).setPosition(x, top - 22)
      tag.add(label(scene, 0, 0, text, textColor).setOrigin(0.5)); root.add(tag)
    }
    const rowH = p1.grid.cellHeight, rosterTop = p1.grid.y + rowH + gap + SECTION_GAP, rosterHeight = 3 * rowH + 2 * gap
    section(`CUSTOMIZE · ${counts.CUSTOMIZE.used}/${counts.CUSTOMIZE.total}`, 0, 4, p1.grid.y, rowH, colors.resultGold, 'background0')
    section(`OFFICERS · ${counts.OFFICERS.used}/${counts.OFFICERS.total}`, 4, 6, p1.grid.y, rowH, colors.playerPrimary, 'textPrimary')
    section(`ROSTER · ${counts.ROSTER.used}/${counts.ROSTER.total}`, 0, GRID_COLUMNS, rosterTop, rosterHeight, colors.lineDim, 'textPrimary')
    model.slots.forEach((slot) => {
      const view = new GridSlotView(scene, slot)
      view.on('pointerover', () => this.hooks.onFocus('P1', slot.index)).on('pointerup', () => { this.hooks.onFocus('P1', slot.index); this.hooks.onInput('P1', 'CONFIRM') })
      this.slotViews.push(view); root.add(view)
    })
    ;(['P1', 'P2'] as const).forEach((owner) => { const cursor = new PlayerCursor(scene, owner); this.cursors[owner] = cursor; root.add(cursor) })
    ;(['P1', 'P2'] as const).forEach((owner) => this.plate(owner))
    this.modeText = label(scene, 960, 215, '', 'textPrimary', type.body).setOrigin(0.5); root.add(this.modeText)
    root.add(label(scene, 960, 1010, 'ESC 返回標題', 'textSecondary').setOrigin(0.5))
    this.keysP1 = label(scene, 96, 1010, '', 'playerGlow').setOrigin(0, 0.5); root.add(this.keysP1)
    this.keysP2 = label(scene, 1824, 1010, '', 'enemyGlow').setOrigin(1, 0.5); root.add(this.keysP2)
  }

  private plate(owner: PlayerSlotId): void {
    const { scene, root } = this, id = identity[owner], left = owner === 'P1'
    const plate = new AngularPanel(scene, 544, 104, colors.panelRaised, 0.9).setPosition(left ? 368 : 1552, 216)
    plate.add(scene.add.rectangle(left ? -262 : 262, 0, 8, 96, id.main))
    plate.add(label(scene, left ? -240 : 240, -26, id.label, id.text, type.title).setOrigin(left ? 0 : 1, 0.5))
    const status = label(scene, left ? 240 : -240, -26, '', 'textSecondary').setOrigin(left ? 1 : 0, 0.5)
    const detail = label(scene, left ? -240 : 240, 22, '', 'textPrimary').setOrigin(left ? 0 : 1, 0.5)
    plate.add([status, detail]); root.add(plate)
    this.plates[owner] = { status, detail }
  }

  private showBanner(): void {
    const panel = new AngularPanel(this.scene, 1100, 130, colors.resultGold, 0.96).setPosition(960, 720)
    panel.add(this.scene.add.text(0, 0, 'ALL READY · 全員就緒', { ...typography.announcer, fontSize: type.h1, color: colorHex('background0'), strokeThickness: 0 }).setOrigin(0.5))
    this.banner = panel; this.root.add(panel)
    if (!reducedMotion) { panel.setScale(0.6, 1).setAlpha(0); this.tweens.push(this.scene.tweens.add({ targets: panel, scaleX: 1, alpha: 1, duration: uiTokens.motionMs.enter, ease: 'Cubic.Out' })) }
    this.bannerTimer = this.scene.time.delayedCall(p1.allReadyMs, () => {
      if (reducedMotion) { this.hooks.onAllReady(); return }
      this.bannerTween = this.scene.tweens.add({ targets: panel, scaleX: 2.5, scaleY: 12, angle: -8, duration: 240, onComplete: () => this.hooks.onAllReady() })
    })
  }

  private buildChamber(): void {
    const { scene, root, model } = this
    const owner = model.owner as PlayerSlotId, id = identity[owner], player = model.player(owner), slot = model.heroSlot(owner) as Slot
    // NEXT UP 佇列條
    const queue = new AngularPanel(scene, 640, 64, colors.panelRaised, 0.9).setPosition(960, 210)
    queue.add(label(scene, -290, 0, 'NEXT UP', 'resultGold', type.body).setOrigin(0, 0.5))
    ;(['P1', 'P2'] as const).filter((p) => model.player(p).joined).forEach((p, i) => {
      const state = p === owner ? 'NOW' : model.isReady(p) ? 'READY' : 'NEXT'
      queue.add(label(scene, -100 + i * 220, 0, `${identity[p].tag} · ${state}`, p === owner ? identity[p].text : state === 'READY' ? 'statusLime' : 'textSecondary', type.body).setOrigin(0, 0.5))
    })
    root.add(queue)
    const chamber = new AngularPanel(scene, 760, 720, colors.panel, 0.92, { slant: 18 }).setPosition(960, 640)
    chamber.shape.setStrokeStyle(2, colors.systemBlue, 0.7); root.add(chamber)
    root.add(label(scene, 960, 300, `${id.label} · ${slot.entry?.displayName ?? ''}`, id.text, type.title).setOrigin(0.5))
    const frame = scene.add.rectangle(960, 640, 640, 340, colors.background0, 0.92).setStrokeStyle(2, colors.systemBlue, 0.9)
    const lines = scene.add.graphics().lineStyle(1, colors.lineDim, 0.6)
    for (let i = 1; i < 3; i += 1) { lines.lineBetween(640 + i * 640 / 3, 470, 640 + i * 640 / 3, 810); lines.lineBetween(640, 470 + i * 340 / 3, 1280, 470 + i * 340 / 3) }
    root.add([frame, lines])
    const button = (text: string, subtitle: string, x: number, color: number, action: OwnedUiAction): ActionButton => {
      const b = new ActionButton(scene, text, 320, 84, color, subtitle).setPosition(x, 940)
      b.on('pointerup', () => this.hooks.onInput(owner, action)); root.add(b); return b
    }
    if (model.phase === 'CUSTOMIZE') {
      const band = new AngularPanel(scene, 640, 36, colors.resultGold, 1, { slant: 10 }).setPosition(960, 446)
      const bandText = label(scene, 0, 0, 'PROTOTYPE / CAMERA NOT CONNECTED · 原型 · 相機未連接', 'background0').setOrigin(0.5)
      band.add(bandText); root.add(band)
      const cameraNote = label(scene, 960, 640, 'CAMERA CONNECTING · 相機連線中（請允許使用相機）', 'systemBlue', type.body).setOrigin(0.5)
      root.add(cameraNote); this.startCamera(cameraNote, bandText)
      root.add(label(scene, 640, 352, 'PLAYER NAME · 玩家名稱', 'textSecondary').setOrigin(0, 0.5))
      this.nameCount = label(scene, 1280, 352, '', 'textSecondary').setOrigin(1, 0.5); root.add(this.nameCount)
      this.nameInput = this.createNameInput(owner, player.nickname)
      button('BACK', `${id.back} · 返回`, 790, colors.panelRaised, 'BACK')
      this.takePhoto = button('TAKE PHOTO', `${id.confirm} · 拍照`, 1130, id.main, 'CONFIRM')
      this.nameHint = label(scene, 960, 856, 'ENTER A NAME FIRST · 請先輸入名稱', 'danger').setOrigin(0.5); root.add(this.nameHint)
      this.refreshName(owner)
    } else if (model.phase === 'REVIEW') {
      if (player.photo) {
        const image = document.createElement('img'); image.src = player.photo; image.alt = 'Captured photo'
        image.style.cssText = 'width:636px;height:336px;object-fit:contain;background:#000'
        this.media = scene.add.dom(960, 640, image)
        root.add(label(scene, 960, 446, 'LOCAL PHOTO · 僅存於本機記憶體，未上傳', 'statusLime').setOrigin(0.5))
      } else {
        root.add(fighterSilhouette(scene, 960, 620, 180, 260, colors.textSecondary, 0.45))
        root.add(label(scene, 960, 790, 'MOCK PHOTO · 模擬照片', 'textSecondary').setOrigin(0.5))
      }
      root.add(label(scene, 960, 400, `${slot.entry?.displayName ?? ''}  ·  ${player.nickname.trim()}`, 'textPrimary', type.body).setOrigin(0.5))
      root.add(scene.add.text(960, 858, 'USE THIS PHOTO? · 使用這張照片？', typography.secondaryAction).setOrigin(0.5))
      button('RETAKE', `${id.back} · 重拍`, 790, colors.panelRaised, 'BACK')
      button('CONFIRM', `${id.confirm} · 確認`, 1130, id.main, 'CONFIRM')
    } else if (model.phase === 'FAILED') {
      root.add(label(scene, 960, 600, 'GENERATION FAILED', 'danger', type.h2).setOrigin(0.5))
      root.add(label(scene, 960, 680, '處理未完成，請重試或重新選角', 'textPrimary', type.body).setOrigin(0.5))
      button('CHOOSE ANOTHER', `${id.back} · 返回選角`, 790, colors.panelRaised, 'BACK')
      button('RETRY', `${id.confirm} · 重試`, 1130, id.main, 'CONFIRM')
    } else {
      this.buildProcessing(slot, player.nickname.trim())
    }
    root.add(label(scene, 960, 1048, model.phase === 'PROCESSING' ? 'MOCK PROCESSING · 請稍候' : `${id.tag}  ${id.confirm} 確認 · ${id.back} 返回`, id.text).setOrigin(0.5))
  }

  private buildProcessing(slot: Slot, nickname: string): void {
    const { scene, root } = this
    root.add(label(scene, 960, 400, `PROCESSING CHARACTER · 角色生成中   ${slot.entry?.displayName ?? ''} · ${nickname}`, 'textPrimary', type.body).setOrigin(0.5))
    const rings = [130, 165, 200].map((radius, i) => {
      const ring = scene.add.graphics().setPosition(960, 640).lineStyle(3, colors.systemBlue, 0.35 + i * 0.15).beginPath()
      ring.arc(0, 0, radius, 0, Math.PI * 1.4).strokePath()
      if (!reducedMotion) this.tweens.push(scene.tweens.add({ targets: ring, angle: i % 2 ? -360 : 360, duration: 1800 + i * 400, repeat: -1 }))
      return ring
    })
    root.add([...rings, fighterSilhouette(scene, 960, 640, 150, 220, colors.resultGold, 0.6)])
    root.add(this.scene.add.rectangle(960, 840, 600, 16, colors.background0).setStrokeStyle(1, colors.lineBright))
    const bar = scene.add.rectangle(660, 840, 600, 16, colors.systemBlue).setOrigin(0, 0.5).setScale(0, 1)
    const percent = scene.add.text(960, 940, '0%', typography.number).setOrigin(0.5)
    const steps = ['REQUESTING', 'PROCESSING', 'READY'].map((step, i) => label(scene, 760 + i * 200, 884, step, 'textSecondary').setOrigin(0.5))
    root.add([bar, percent, ...steps])
    root.add(label(scene, 960, 1004, 'MOCK PROCESSING · 模擬處理 · 未連接生成服務', 'resultGold').setOrigin(0.5))
    const show = (value: number): void => { bar.setScale(value, 1); percent.setText(Math.round(value * 100) + '%'); steps.forEach((step, i) => step.setColor(colorHex(value >= [0, 0.25, 1][i] ? (i === 2 ? 'statusLime' : 'systemBlue') : 'textSecondary'))) }
    show(0)
    if (!reducedMotion) this.tweens.push(scene.tweens.addCounter({ from: 0, to: 1, duration: p1.processingMs, onUpdate: (tween) => show(tween.getValue() ?? 0) }))
    this.timers.push(scene.time.delayedCall(p1.processingMs, () => { show(1); this.hooks.onProcessingDone() }))
  }

  private createNameInput(owner: PlayerSlotId, value: string): Phaser.GameObjects.DOMElement {
    const input = document.createElement('input')
    input.maxLength = NICKNAME_MAX; input.value = value; input.placeholder = 'PLAYER NAME'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Player name')
    input.style.cssText = `width:600px;height:56px;padding:0 16px;box-sizing:border-box;border:0;border-bottom:3px solid ${colorHex(identity[owner].text)};background:${colorHex('background1')};color:${colorHex('textPrimary')};font:24px Chivo,'Noto Sans TC',sans-serif;outline:none`
    // 打字期間不讓按鍵進入遊戲輸入（WASD/J/K/Backspace 都是文字）；Enter／Esc 結束輸入。
    input.addEventListener('keydown', (event) => { event.stopPropagation(); if (!event.isComposing && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); input.blur(); this.takePhoto?.setFocused(this.model.nicknameValid(owner)) } })
    input.addEventListener('input', () => { this.hooks.onNickname(owner, input.value); this.refreshName(owner) })
    const element = this.scene.add.dom(960, 392, input)
    input.focus()
    return element
  }

  private refreshName(owner: PlayerSlotId): void {
    const valid = this.model.nicknameValid(owner)
    this.nameCount?.setText(`${this.model.player(owner).nickname.length}/${NICKNAME_MAX}`)
    this.takePhoto?.setEnabled(valid); this.nameHint?.setVisible(!valid)
  }
}
